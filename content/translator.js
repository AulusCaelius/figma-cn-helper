/**
 * Figma 中文汉化助手 - 核心内容脚本（DOM 翻译引擎 + 快捷键速查 + 页面取词）
 */
(function () {
  "use strict";

  const STORAGE_KEY = "figmaCnSettings";
  const DEFAULT_SETTINGS = {
    enabled: true,
    translateAttributes: true,
    protectUserContent: true,
    peekOriginalOnAlt: true,
    customDict: {}
  };

  const SKIP_TAGS = new Set([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "TEXTAREA",
    "CODE",
    "PRE",
    "CANVAS",
    "SVG",
    "MATH",
    "IFRAME",
    "OBJECT",
    "VIDEO",
    "AUDIO"
  ]);

  const PROTECTED_SELECTORS = [
    '[contenteditable="true"]',
    '[contenteditable=""]',
    ".monaco-editor",
    '[data-figma-cn-ui="true"]'
  ];

  const USER_CONTENT_SELECTORS = [
    '[data-testid*="layer-row"]',
    '[data-testid*="file-name"]',
    '[data-testid*="comment-body"]',
    '[class*="object_row--rowText"]',
    '[class*="pages_panel--rowText"]',
    '[class*="filename_view--title"]',
    '[class*="tile_view--title"]',
    '[class*="file_row--name"]',
    '[class*="comment_text"]'
  ];

  const TRANSLATABLE_ATTRS = ["placeholder", "title", "aria-label", "data-tooltip"];

  const BASE_DICT = window.__FIGMA_CN_BASE_DICT__ || {};
  const REGEX_RULES = window.__FIGMA_CN_REGEX_RULES__ || [];

  // 构建大小写不敏感查找表（精确匹配优先，大小写不敏感兜底）
  const BASE_LOWER_MAP = new Map();
  for (const [k, v] of Object.entries(BASE_DICT)) {
    const lower = k.toLowerCase();
    if (!BASE_LOWER_MAP.has(lower)) {
      BASE_LOWER_MAP.set(lower, v);
    }
  }

  let settings = { ...DEFAULT_SETTINGS, customDict: {} };
  let customLowerMap = new Map();
  let isPeekingOriginal = false;
  let observer = null;
  let rafScheduled = false;
  let pendingNodes = new Set();

  // WeakMap 避免对已卸载 React 节点造成内存泄漏
  const textRecords = new WeakMap(); // Text -> { original, translated }
  const attrRecords = new WeakMap(); // Element -> Map<attr, { original, translated }>

  // 页面取词状态
  let pickerActive = false;
  let pickerHost = null;
  let pickerShadow = null;
  let pickerHighlight = null;
  let pickerModalOpen = false;
  let lastHoveredEl = null;

  function rebuildCustomLookup() {
    customLowerMap = new Map();
    const custom = settings.customDict || {};
    for (const [k, v] of Object.entries(custom)) {
      if (!k || typeof v !== "string" || !v.trim()) continue;
      customLowerMap.set(normalizeLookupText(k).toLowerCase(), v.trim());
    }
  }

  function isActiveTranslation() {
    return Boolean(settings.enabled) && !isPeekingOriginal;
  }

  function normalizeLookupText(str) {
    return str
      .replace(/\u2026/g, "...")
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/\u00A0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function lookupExactOrLower(text) {
    const custom = settings.customDict || {};
    if (Object.prototype.hasOwnProperty.call(custom, text) && custom[text]) {
      return custom[text];
    }
    const lower = text.toLowerCase();
    if (customLowerMap.has(lower)) {
      return customLowerMap.get(lower);
    }
    if (Object.prototype.hasOwnProperty.call(BASE_DICT, text)) {
      return BASE_DICT[text];
    }
    if (BASE_LOWER_MAP.has(lower)) {
      return BASE_LOWER_MAP.get(lower);
    }
    return null;
  }

  /**
   * 翻译纯文本，保留首尾空白字符；无匹配返回 null
   */
  function translateString(raw) {
    if (!raw || typeof raw !== "string") return null;
    const match = raw.match(/^(\s*)([\s\S]*?)(\s*)$/);
    if (!match) return null;

    const lead = match[1];
    const core = match[2];
    const trail = match[3];

    if (!core || core.length > 260) return null;
    if (!/[A-Za-z]/.test(core)) return null;

    const normalized = normalizeLookupText(core);
    if (!normalized) return null;

    // 1. 精确 / 大小写不敏感匹配（先原文再标点归一化版本，兼容 … / 智能引号 / 换行文本）
    const direct = lookupExactOrLower(core) || (normalized !== core ? lookupExactOrLower(normalized) : null);
    if (direct) {
      return lead + direct + trail;
    }

    // 2. 自动兼容带末尾省略号（... 或 …）的菜单项
    if (normalized.endsWith("...") && normalized.length > 3) {
      const withoutEllipsis = normalized.slice(0, -3).trim();
      const baseHit = lookupExactOrLower(withoutEllipsis);
      if (baseHit) {
        return lead + baseHit + "..." + trail;
      }
    }

    // 3. 动态正则规则（时间、数量、动态操作）
    for (let i = 0; i < REGEX_RULES.length; i++) {
      const rule = REGEX_RULES[i];
      if (rule.pattern.test(normalized)) {
        const replaced = normalized.replace(rule.pattern, rule.replace);
        if (replaced && replaced !== normalized) {
          return lead + replaced + trail;
        }
      }
    }

    return null;
  }

  function isInsideSelectorList(el, selectors) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    for (let i = 0; i < selectors.length; i++) {
      try {
        if (el.closest(selectors[i])) return true;
      } catch (_) {
        // 忽略极端情况下的选择器异常
      }
    }
    return false;
  }

  function shouldSkipElementForText(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return true;
    if (SKIP_TAGS.has(el.tagName)) return true;
    if (el.tagName === "INPUT") return true;
    if (isInsideSelectorList(el, PROTECTED_SELECTORS)) return true;
    if (settings.protectUserContent && isInsideSelectorList(el, USER_CONTENT_SELECTORS)) {
      return true;
    }
    return false;
  }

  function shouldSkipElementForAttrs(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return true;
    if (SKIP_TAGS.has(el.tagName)) return true;
    if (isInsideSelectorList(el, PROTECTED_SELECTORS)) return true;
    return false;
  }

  function processTextNode(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE) return;
    const parent = node.parentElement;
    if (!parent || shouldSkipElementForText(parent)) return;

    const currentVal = node.nodeValue;
    const record = textRecords.get(node);

    if (!isActiveTranslation()) {
      if (record && currentVal === record.translated) {
        node.nodeValue = record.original;
      }
      return;
    }

    // 决定基准英文原文
    let originalText = currentVal;
    if (record) {
      if (currentVal === record.translated) {
        // 检查是否因自定义词库更新需要重新翻译
        const nextTranslated = translateString(record.original);
        if (nextTranslated && nextTranslated !== record.translated) {
          record.translated = nextTranslated;
          node.nodeValue = nextTranslated;
        } else if (!nextTranslated) {
          node.nodeValue = record.original;
          textRecords.delete(node);
        }
        return;
      }
      if (currentVal === record.original) {
        originalText = record.original;
      } else {
        // React 更新了此节点的文案
        originalText = currentVal;
      }
    }

    const translated = translateString(originalText);
    if (translated && translated !== originalText) {
      textRecords.set(node, { original: originalText, translated });
      node.nodeValue = translated;
    } else if (record && currentVal !== record.original) {
      textRecords.delete(node);
    }
  }

  function processElementAttrs(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return;
    if (shouldSkipElementForAttrs(el)) return;

    let map = attrRecords.get(el);

    if (!isActiveTranslation() || !settings.translateAttributes) {
      if (map) {
        for (const [attr, rec] of map.entries()) {
          if (el.getAttribute(attr) === rec.translated) {
            el.setAttribute(attr, rec.original);
          }
        }
      }
      return;
    }

    for (let i = 0; i < TRANSLATABLE_ATTRS.length; i++) {
      const attr = TRANSLATABLE_ATTRS[i];
      if (!el.hasAttribute(attr)) continue;
      const cur = el.getAttribute(attr);
      if (!cur) continue;

      const existing = map ? map.get(attr) : null;
      let originalVal = cur;

      if (existing) {
        if (cur === existing.translated) {
          const next = translateString(existing.original);
          if (next && next !== existing.translated) {
            existing.translated = next;
            el.setAttribute(attr, next);
          } else if (!next) {
            el.setAttribute(attr, existing.original);
            map.delete(attr);
          }
          continue;
        }
        if (cur === existing.original) {
          originalVal = existing.original;
        }
      }

      const translated = translateString(originalVal);
      if (translated && translated !== originalVal) {
        if (!map) {
          map = new Map();
          attrRecords.set(el, map);
        }
        map.set(attr, { original: originalVal, translated });
        el.setAttribute(attr, translated);
      }
    }
  }

  function walkAndProcess(root) {
    if (!root) return;

    if (root.nodeType === Node.TEXT_NODE) {
      processTextNode(root);
      return;
    }

    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
      return;
    }

    if (root.nodeType === Node.ELEMENT_NODE) {
      if (SKIP_TAGS.has(root.tagName) || root.getAttribute("data-figma-cn-ui") === "true") {
        return;
      }
      processElementAttrs(root);
    }

    // 遍历元素属性与所有文本节点
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      {
        acceptNode(n) {
          if (n.nodeType === Node.ELEMENT_NODE) {
            if (SKIP_TAGS.has(n.tagName) || n.getAttribute("data-figma-cn-ui") === "true") {
              return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let current = walker.nextNode();
    while (current) {
      if (current.nodeType === Node.TEXT_NODE) {
        processTextNode(current);
      } else if (current.nodeType === Node.ELEMENT_NODE) {
        processElementAttrs(current);
      }
      current = walker.nextNode();
    }
  }

  function countTranslatedOnPage() {
    if (!document.body) return 0;
    let count = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n = walker.nextNode();
    while (n) {
      const rec = textRecords.get(n);
      if (rec && n.nodeValue === rec.translated) {
        count++;
      }
      n = walker.nextNode();
    }
    return count;
  }

  function flushPending() {
    rafScheduled = false;
    const batch = Array.from(pendingNodes);
    pendingNodes.clear();
    for (let i = 0; i < batch.length; i++) {
      const node = batch[i];
      if (!node || !node.isConnected) continue;
      walkAndProcess(node);
    }
  }

  function scheduleNode(node) {
    if (!node) return;
    pendingNodes.add(node);
    if (!rafScheduled) {
      rafScheduled = true;
      requestAnimationFrame(flushPending);
    }
  }

  function startObserver() {
    if (observer || !document.documentElement) return;
    observer = new MutationObserver((mutations) => {
      if (!isActiveTranslation()) return;
      for (let i = 0; i < mutations.length; i++) {
        const m = mutations[i];
        if (m.type === "childList") {
          for (let j = 0; j < m.addedNodes.length; j++) {
            scheduleNode(m.addedNodes[j]);
          }
        } else if (m.type === "characterData") {
          scheduleNode(m.target);
        } else if (m.type === "attributes" && m.target) {
          processElementAttrs(m.target);
        }
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: TRANSLATABLE_ATTRS
    });
  }

  function rescanDocument() {
    if (document.body) {
      walkAndProcess(document.body);
    }
  }

  // =========================================================================
  // 长按 Option (Alt) 临时查看英文原文
  // =========================================================================
  function bindAltPeekListeners() {
    window.addEventListener(
      "keydown",
      (e) => {
        if (!settings.enabled || !settings.peekOriginalOnAlt || pickerActive) return;
        if (e.key === "Alt" && !e.metaKey && !e.ctrlKey && !e.shiftKey && !isPeekingOriginal) {
          // 仅当未聚焦输入框时触发，避免干扰特殊字符输入
          const active = document.activeElement;
          if (
            active &&
            (active.tagName === "INPUT" ||
              active.tagName === "TEXTAREA" ||
              active.isContentEditable)
          ) {
            return;
          }
          isPeekingOriginal = true;
          rescanDocument();
        }
      },
      true
    );

    const restoreAfterPeek = () => {
      if (!isPeekingOriginal) return;
      isPeekingOriginal = false;
      rescanDocument();
    };

    window.addEventListener("keyup", (e) => {
      if (e.key === "Alt") restoreAfterPeek();
    }, true);
    window.addEventListener("blur", restoreAfterPeek, true);
  }

  // =========================================================================
  // 页面取词补充翻译（Shadow DOM 隔离 UI，不污染 Figma 样式）
  // =========================================================================
  function extractOriginalTextFromElement(el) {
    if (!el) return "";
    // 优先查直接子节点里的 Text 节点
    const texts = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n = walker.nextNode();
    while (n) {
      const rec = textRecords.get(n);
      const raw = rec ? rec.original : n.nodeValue;
      if (raw && raw.trim()) {
        texts.push(raw.trim());
      }
      n = walker.nextNode();
    }
    if (texts.length > 0) {
      return texts[0];
    }
    // 兜底查属性
    const map = attrRecords.get(el);
    for (const attr of TRANSLATABLE_ATTRS) {
      if (map && map.has(attr)) {
        return map.get(attr).original.trim();
      }
      const val = el.getAttribute(attr);
      if (val && val.trim()) return val.trim();
    }
    return "";
  }

  function ensurePickerUI() {
    if (pickerHost) return;
    pickerHost = document.createElement("div");
    pickerHost.setAttribute("data-figma-cn-ui", "true");
    pickerHost.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483646;";
    pickerShadow = pickerHost.attachShadow({ mode: "open" });

    pickerShadow.innerHTML = `
      <style>
        * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", sans-serif; }
        .banner {
          position: fixed; top: 14px; left: 50%; transform: translateX(-50%);
          background: #1e1e1e; color: #fff; padding: 10px 16px; border-radius: 10px;
          box-shadow: 0 8px 28px rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.14);
          display: flex; align-items: center; gap: 12px; font-size: 13px;
          pointer-events: auto;
        }
        .badge {
          background: #0d99ff; color: #fff; font-weight: 600; font-size: 11px;
          padding: 2px 7px; border-radius: 5px;
        }
        .exit-btn {
          background: rgba(255,255,255,0.12); color: #fff; border: none;
          border-radius: 6px; padding: 4px 10px; font-size: 12px; cursor: pointer;
        }
        .exit-btn:hover { background: rgba(255,255,255,0.22); }
        .highlight {
          position: fixed; pointer-events: none; border: 2px solid #0d99ff;
          background: rgba(13, 153, 255, 0.12); border-radius: 4px;
          transition: all 0.05s ease-out; display: none;
        }
        .backdrop {
          position: fixed; inset: 0; background: rgba(0,0,0,0.45);
          display: none; align-items: center; justify-content: center;
          pointer-events: auto;
        }
        .backdrop.open { display: flex; }
        .modal {
          width: 380px; max-width: calc(100vw - 32px);
          background: #2c2c2c; color: #f5f5f5; border-radius: 12px;
          border: 1px solid rgba(255,255,255,0.12);
          box-shadow: 0 20px 50px rgba(0,0,0,0.5); padding: 18px;
        }
        .modal h3 { margin: 0 0 12px; font-size: 15px; font-weight: 600; }
        .field { margin-bottom: 12px; }
        .field label { display: block; font-size: 12px; color: #b3b3b3; margin-bottom: 5px; }
        .field input {
          width: 100%; padding: 8px 10px; border-radius: 7px;
          border: 1px solid rgba(255,255,255,0.18); background: #1e1e1e;
          color: #fff; font-size: 13px; outline: none;
        }
        .field input:focus { border-color: #0d99ff; }
        .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
        .btn {
          border: none; border-radius: 7px; padding: 7px 14px;
          font-size: 13px; cursor: pointer; font-weight: 500;
        }
        .btn-cancel { background: rgba(255,255,255,0.1); color: #e5e5e5; }
        .btn-cancel:hover { background: rgba(255,255,255,0.18); }
        .btn-save { background: #0d99ff; color: #fff; }
        .btn-save:hover { background: #007be5; }
      </style>
      <div class="highlight" id="hl"></div>
      <div class="banner" id="banner">
        <span class="badge">取词模式</span>
        <span>点击任意 Figma 英文文案以补充中文翻译（按 Esc 退出）</span>
        <button class="exit-btn" id="exitBtn">退出</button>
      </div>
      <div class="backdrop" id="backdrop">
        <div class="modal">
          <h3>补充自定义词条</h3>
          <div class="field">
            <label>英文原文（精确匹配）</label>
            <input id="enInput" type="text" placeholder="例如：Auto layout" />
          </div>
          <div class="field">
            <label>简体中文译文</label>
            <input id="zhInput" type="text" placeholder="例如：自动布局" />
          </div>
          <div class="actions">
            <button class="btn btn-cancel" id="cancelBtn">取消</button>
            <button class="btn btn-save" id="saveBtn">保存并生效</button>
          </div>
        </div>
      </div>
    `;

    pickerHighlight = pickerShadow.getElementById("hl");
    pickerShadow.getElementById("exitBtn").addEventListener("click", stopPicker);
    pickerShadow.getElementById("cancelBtn").addEventListener("click", closePickerModal);
    pickerShadow.getElementById("saveBtn").addEventListener("click", savePickerEntry);
    pickerShadow.getElementById("zhInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") savePickerEntry();
      if (e.key === "Escape") closePickerModal();
    });

    document.documentElement.appendChild(pickerHost);
  }

  function closePickerModal() {
    pickerModalOpen = false;
    if (pickerShadow) {
      pickerShadow.getElementById("backdrop").classList.remove("open");
    }
  }

  function savePickerEntry() {
    if (!pickerShadow) return;
    const en = pickerShadow.getElementById("enInput").value.trim();
    const zh = pickerShadow.getElementById("zhInput").value.trim();
    if (!en || !zh) return;

    const nextCustom = { ...(settings.customDict || {}), [en]: zh };
    settings.customDict = nextCustom;
    rebuildCustomLookup();

    try {
      chrome.storage.local.set({ [STORAGE_KEY]: settings }, () => {
        if (chrome.runtime && chrome.runtime.lastError) {
          // 忽略上下文失效时的存储报错
        }
        closePickerModal();
        stopPicker();
        rescanDocument();
      });
    } catch (_) {
      closePickerModal();
      stopPicker();
      rescanDocument();
    }
  }

  function onPickerMouseMove(e) {
    if (!pickerActive || pickerModalOpen) return;
    const target = document.elementFromPoint(e.clientX, e.clientY);
    if (!target || target === pickerHost || target.closest('[data-figma-cn-ui="true"]')) {
      return;
    }
    lastHoveredEl = target;
    const rect = target.getBoundingClientRect();
    if (pickerHighlight) {
      pickerHighlight.style.display = "block";
      pickerHighlight.style.left = rect.left + "px";
      pickerHighlight.style.top = rect.top + "px";
      pickerHighlight.style.width = rect.width + "px";
      pickerHighlight.style.height = rect.height + "px";
    }
  }

  function onPickerClick(e) {
    if (!pickerActive || pickerModalOpen) return;
    if (e.target === pickerHost || (e.target.closest && e.target.closest('[data-figma-cn-ui="true"]'))) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();

    const target = lastHoveredEl || e.target;
    const original = extractOriginalTextFromElement(target);
    const existingZh =
      (settings.customDict && settings.customDict[original]) ||
      translateString(original) ||
      "";

    pickerModalOpen = true;
    if (pickerHighlight) pickerHighlight.style.display = "none";

    const enInput = pickerShadow.getElementById("enInput");
    const zhInput = pickerShadow.getElementById("zhInput");
    enInput.value = original;
    zhInput.value = existingZh === original ? "" : existingZh;
    pickerShadow.getElementById("backdrop").classList.add("open");
    setTimeout(() => (original ? zhInput.focus() : enInput.focus()), 20);
  }

  function onPickerKeyDown(e) {
    if (!pickerActive) return;
    if (e.key === "Escape") {
      if (pickerModalOpen) {
        closePickerModal();
      } else {
        stopPicker();
      }
    }
  }

  function startPicker() {
    if (pickerActive) return;
    pickerActive = true;
    ensurePickerUI();
    pickerHost.style.display = "block";
    document.addEventListener("mousemove", onPickerMouseMove, true);
    document.addEventListener("click", onPickerClick, true);
    document.addEventListener("keydown", onPickerKeyDown, true);
  }

  function stopPicker() {
    if (!pickerActive) return;
    pickerActive = false;
    pickerModalOpen = false;
    lastHoveredEl = null;
    if (pickerHighlight) pickerHighlight.style.display = "none";
    if (pickerShadow) {
      pickerShadow.getElementById("backdrop").classList.remove("open");
    }
    if (pickerHost) pickerHost.style.display = "none";
    document.removeEventListener("mousemove", onPickerMouseMove, true);
    document.removeEventListener("click", onPickerClick, true);
    document.removeEventListener("keydown", onPickerKeyDown, true);
  }

  // =========================================================================
  // 初始化 & 通信
  // =========================================================================
  function applySettings(newSettings) {
    settings = {
      ...DEFAULT_SETTINGS,
      ...(newSettings || {}),
      customDict: { ...((newSettings && newSettings.customDict) || {}) }
    };
    rebuildCustomLookup();
    rescanDocument();
  }

  function initTranslator() {
    const boot = (stored) => {
      applySettings(stored);
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => {
          startObserver();
          rescanDocument();
        });
      } else {
        startObserver();
        rescanDocument();
      }
    };

    try {
      chrome.storage.local.get([STORAGE_KEY], (res) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          boot(null);
          return;
        }
        boot(res && res[STORAGE_KEY]);
      });
    } catch (_) {
      boot(null);
    }
  }

  initTranslator();

  try {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes[STORAGE_KEY]) return;
      applySettings(changes[STORAGE_KEY].newValue);
    });

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg || !msg.type) return false;
      if (msg.type === "GET_STATUS") {
        sendResponse({
          enabled: settings.enabled,
          translatedCount: countTranslatedOnPage(),
          builtInCount: Object.keys(BASE_DICT).length,
          customCount: Object.keys(settings.customDict || {}).length,
          pickerActive
        });
        return false;
      }
      if (msg.type === "START_PICKER") {
        startPicker();
        sendResponse({ ok: true });
        return false;
      }
      if (msg.type === "STOP_PICKER") {
        stopPicker();
        sendResponse({ ok: true });
        return false;
      }
      if (msg.type === "FORCE_RESCAN") {
        rescanDocument();
        sendResponse({ ok: true, translatedCount: countTranslatedOnPage() });
        return false;
      }
      return false;
    });
  } catch (_) {
    // 忽略极端情况下的扩展上下文异常
  }

  bindAltPeekListeners();
})();

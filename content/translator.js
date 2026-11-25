/**
 * Figma 中文汉化助手 - 核心内容脚本（DOM 翻译引擎 + 快捷键速查）
 */
(function () {
  "use strict";

  const STORAGE_KEY = "figmaCnSettings";
  const DEFAULT_SETTINGS = {
    enabled: true,
    translateAttributes: true,
    protectUserContent: true,
    peekOriginalOnAlt: true
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
    ".monaco-editor"
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

  const BASE_LOWER_MAP = new Map();
  for (const [k, v] of Object.entries(BASE_DICT)) {
    const lower = k.toLowerCase();
    if (!BASE_LOWER_MAP.has(lower)) {
      BASE_LOWER_MAP.set(lower, v);
    }
  }

  let settings = { ...DEFAULT_SETTINGS };
  let isPeekingOriginal = false;
  let observer = null;
  let rafScheduled = false;
  let pendingNodes = new Set();

  const textRecords = new WeakMap();
  const attrRecords = new WeakMap();

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
    if (Object.prototype.hasOwnProperty.call(BASE_DICT, text)) {
      return BASE_DICT[text];
    }
    const lower = text.toLowerCase();
    if (BASE_LOWER_MAP.has(lower)) {
      return BASE_LOWER_MAP.get(lower);
    }
    return null;
  }

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

    const direct = lookupExactOrLower(core) || (normalized !== core ? lookupExactOrLower(normalized) : null);
    if (direct) {
      return lead + direct + trail;
    }

    if (normalized.endsWith("...") && normalized.length > 3) {
      const withoutEllipsis = normalized.slice(0, -3).trim();
      const baseHit = lookupExactOrLower(withoutEllipsis);
      if (baseHit) {
        return lead + baseHit + "..." + trail;
      }
    }

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
        // 忽略选择器异常
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

    let originalText = currentVal;
    if (record) {
      if (currentVal === record.translated) {
        return;
      }
      if (currentVal === record.original) {
        originalText = record.original;
      } else {
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
      if (SKIP_TAGS.has(root.tagName)) return;
      processElementAttrs(root);
    }

    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      {
        acceptNode(n) {
          if (n.nodeType === Node.ELEMENT_NODE && SKIP_TAGS.has(n.tagName)) {
            return NodeFilter.FILTER_REJECT;
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

  function bindAltPeekListeners() {
    window.addEventListener(
      "keydown",
      (e) => {
        if (!settings.enabled || !settings.peekOriginalOnAlt) return;
        if (e.key === "Alt" && !e.metaKey && !e.ctrlKey && !e.shiftKey && !isPeekingOriginal) {
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

  function applySettings(newSettings) {
    settings = {
      ...DEFAULT_SETTINGS,
      ...(newSettings || {})
    };
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
          builtInCount: Object.keys(BASE_DICT).length
        });
        return false;
      }
      return false;
    });
  } catch (_) {
    // 忽略极端情况下的扩展上下文异常
  }

  bindAltPeekListeners();
})();

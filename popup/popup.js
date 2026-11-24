(function () {
  "use strict";

  const STORAGE_KEY = "figmaCnSettings";
  const FIGMA_URL_RE = /^https:\/\/(?:www\.)?figma\.com(?:\/|$)/i;
  const DEFAULT_SETTINGS = {
    enabled: true,
    translateAttributes: true,
    protectUserContent: true,
    peekOriginalOnAlt: true,
    customDict: {}
  };

  const els = {
    enabledToggle: document.getElementById("enabledToggle"),
    peekAltToggle: document.getElementById("peekAltToggle"),
    attrToggle: document.getElementById("attrToggle"),
    protectToggle: document.getElementById("protectToggle"),
    pageStatus: document.getElementById("pageStatus"),
    builtInCount: document.getElementById("builtInCount"),
    customCount: document.getElementById("customCount"),
    translatedCount: document.getElementById("translatedCount"),
    pickerBtn: document.getElementById("pickerBtn"),
    rescanBtn: document.getElementById("rescanBtn"),
    addEntryForm: document.getElementById("addEntryForm"),
    newEnInput: document.getElementById("newEnInput"),
    newZhInput: document.getElementById("newZhInput"),
    dictSearch: document.getElementById("dictSearch"),
    dictList: document.getElementById("dictList"),
    exportBtn: document.getElementById("exportBtn"),
    importBtn: document.getElementById("importBtn"),
    importFile: document.getElementById("importFile"),
    clearCustomBtn: document.getElementById("clearCustomBtn"),
    toast: document.getElementById("toast")
  };

  let settings = { ...DEFAULT_SETTINGS, customDict: {} };
  let toastTimer = null;

  // 兜底防止偶发异步异常污染扩展错误面板
  window.addEventListener("unhandledrejection", (event) => {
    event.preventDefault();
  });

  const builtInTotal = Object.keys(window.__FIGMA_CN_BASE_DICT__ || {}).length;
  if (els.builtInCount) {
    els.builtInCount.textContent = String(builtInTotal);
  }

  function showToast(msg) {
    if (!els.toast) return;
    els.toast.textContent = msg;
    els.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove("show"), 1800);
  }

  function storageGet(keys) {
    return new Promise((resolve) => {
      try {
        if (!chrome || !chrome.storage || !chrome.storage.local) {
          resolve({});
          return;
        }
        chrome.storage.local.get(keys, (res) => {
          if (chrome.runtime && chrome.runtime.lastError) {
            resolve({});
            return;
          }
          resolve(res || {});
        });
      } catch (_) {
        resolve({});
      }
    });
  }

  function storageSet(obj) {
    return new Promise((resolve) => {
      try {
        if (!chrome || !chrome.storage || !chrome.storage.local) {
          resolve(false);
          return;
        }
        chrome.storage.local.set(obj, () => {
          if (chrome.runtime && chrome.runtime.lastError) {
            resolve(false);
            return;
          }
          resolve(true);
        });
      } catch (_) {
        resolve(false);
      }
    });
  }

  async function saveSettings(next, toastMsg) {
    settings = {
      ...DEFAULT_SETTINGS,
      ...next,
      customDict: { ...(next.customDict || {}) }
    };
    await storageSet({ [STORAGE_KEY]: settings });
    renderUI();
    if (toastMsg) showToast(toastMsg);
    setTimeout(() => {
      refreshActiveTabStatus();
    }, 120);
  }

  function renderDictList() {
    const query = (els.dictSearch.value || "").trim().toLowerCase();
    const entries = Object.entries(settings.customDict || {}).filter(([en, zh]) => {
      if (!query) return true;
      return en.toLowerCase().includes(query) || zh.toLowerCase().includes(query);
    });

    els.dictList.innerHTML = "";
    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "dict-empty";
      empty.textContent = query
        ? "未找到匹配的自定义词条"
        : "暂无自定义词条，可在上方添加或使用「页面取词」";
      els.dictList.appendChild(empty);
      return;
    }

    entries.sort((a, b) => a[0].localeCompare(b[0]));
    for (const [en, zh] of entries) {
      const row = document.createElement("div");
      row.className = "dict-row";

      const pair = document.createElement("div");
      pair.className = "dict-pair";

      const enDiv = document.createElement("div");
      enDiv.className = "dict-en";
      enDiv.textContent = en;

      const zhDiv = document.createElement("div");
      zhDiv.className = "dict-zh";
      zhDiv.textContent = zh;

      pair.appendChild(enDiv);
      pair.appendChild(zhDiv);

      const delBtn = document.createElement("button");
      delBtn.className = "del-btn";
      delBtn.title = "删除该词条";
      delBtn.textContent = "×";
      delBtn.addEventListener("click", () => {
        const nextCustom = { ...(settings.customDict || {}) };
        delete nextCustom[en];
        saveSettings({ ...settings, customDict: nextCustom }, "已删除词条");
      });

      row.appendChild(pair);
      row.appendChild(delBtn);
      els.dictList.appendChild(row);
    }
  }

  function renderUI() {
    els.enabledToggle.checked = Boolean(settings.enabled);
    els.peekAltToggle.checked = Boolean(settings.peekOriginalOnAlt);
    els.attrToggle.checked = Boolean(settings.translateAttributes);
    els.protectToggle.checked = Boolean(settings.protectUserContent);
    els.customCount.textContent = String(Object.keys(settings.customDict || {}).length);
    renderDictList();
  }

  function queryActiveTab() {
    return new Promise((resolve) => {
      try {
        if (!chrome || !chrome.tabs || typeof chrome.tabs.query !== "function") {
          resolve(null);
          return;
        }
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (chrome.runtime && chrome.runtime.lastError) {
            resolve(null);
            return;
          }
          if (!Array.isArray(tabs) || tabs.length === 0) {
            resolve(null);
            return;
          }
          const tab = tabs[0];
          const tabIdNone =
            typeof chrome.tabs.TAB_ID_NONE === "number" ? chrome.tabs.TAB_ID_NONE : -1;
          if (!tab || typeof tab.id !== "number" || tab.id === tabIdNone || tab.id < 0) {
            resolve(null);
            return;
          }
          resolve(tab);
        });
      } catch (_) {
        resolve(null);
      }
    });
  }

  function sendMessageSafe(tabId, message) {
    return new Promise((resolve) => {
      try {
        if (!chrome || !chrome.tabs || typeof chrome.tabs.sendMessage !== "function") {
          resolve(null);
          return;
        }
        chrome.tabs.sendMessage(tabId, message, (resp) => {
          if (chrome.runtime && chrome.runtime.lastError) {
            resolve(null);
            return;
          }
          resolve(resp || null);
        });
      } catch (_) {
        resolve(null);
      }
    });
  }

  async function sendToActiveFigmaTab(message) {
    const tab = await queryActiveTab();
    if (!tab) {
      return { state: "NO_TAB", resp: null };
    }
    if (typeof tab.url === "string" && !FIGMA_URL_RE.test(tab.url)) {
      return { state: "NOT_FIGMA", resp: null };
    }
    const resp = await sendMessageSafe(tab.id, message);
    if (!resp) {
      const isFigma = typeof tab.url === "string" && FIGMA_URL_RE.test(tab.url);
      return { state: isFigma ? "NEED_RELOAD" : "NOT_FIGMA", resp: null };
    }
    return { state: "OK", resp };
  }

  async function refreshActiveTabStatus() {
    const { state, resp } = await sendToActiveFigmaTab({ type: "GET_STATUS" });
    if (state !== "OK" || !resp) {
      els.translatedCount.textContent = "--";
      els.pickerBtn.disabled = true;
      els.rescanBtn.disabled = true;
      if (state === "NEED_RELOAD") {
        els.pageStatus.textContent = "请刷新当前 Figma 页面以激活汉化插件";
      } else {
        els.pageStatus.textContent = "当前标签页不是 Figma（请在 figma.com 使用）";
      }
      return;
    }

    els.pickerBtn.disabled = false;
    els.rescanBtn.disabled = false;
    els.translatedCount.textContent = String(resp.translatedCount || 0);
    els.pageStatus.textContent = resp.enabled
      ? "已连接 Figma 页面 · 实时汉化生效中"
      : "已连接 Figma 页面 · 当前为英文原版";
  }

  // Tabs switching
  document.querySelectorAll(".tab").forEach((tabBtn) => {
    tabBtn.addEventListener("click", () => {
      const target = tabBtn.dataset.tab;
      document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tabBtn));
      document.querySelectorAll(".panel").forEach((p) => {
        if (p && p.id) {
          p.classList.toggle("active", p.id === `panel-${target}`);
        }
      });
    });
  });

  // Setting toggles
  els.enabledToggle.addEventListener("change", () => {
    saveSettings(
      { ...settings, enabled: els.enabledToggle.checked },
      els.enabledToggle.checked ? "已开启中文汉化" : "已切换为英文原版"
    );
  });

  els.peekAltToggle.addEventListener("change", () => {
    saveSettings({ ...settings, peekOriginalOnAlt: els.peekAltToggle.checked });
  });

  els.attrToggle.addEventListener("change", () => {
    saveSettings({ ...settings, translateAttributes: els.attrToggle.checked });
  });

  els.protectToggle.addEventListener("change", () => {
    saveSettings({ ...settings, protectUserContent: els.protectToggle.checked });
  });

  // Quick actions
  els.pickerBtn.addEventListener("click", async () => {
    const { state, resp } = await sendToActiveFigmaTab({ type: "START_PICKER" });
    if (state === "OK" && resp && resp.ok) {
      window.close();
    } else if (state === "NEED_RELOAD") {
      showToast("请先刷新当前 Figma 页面");
    } else {
      showToast("请在打开的 Figma 页面中使用取词");
    }
  });

  els.rescanBtn.addEventListener("click", async () => {
    const { state, resp } = await sendToActiveFigmaTab({ type: "FORCE_RESCAN" });
    if (state === "OK" && resp && resp.ok) {
      els.translatedCount.textContent = String(resp.translatedCount || 0);
      showToast("已重新扫描当前页面");
    } else if (state === "NEED_RELOAD") {
      showToast("请先刷新当前 Figma 页面");
    }
  });

  // Custom dictionary management
  els.addEntryForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const en = els.newEnInput.value.trim();
    const zh = els.newZhInput.value.trim();
    if (!en || !zh) return;

    const nextCustom = { ...(settings.customDict || {}), [en]: zh };
    els.newEnInput.value = "";
    els.newZhInput.value = "";
    saveSettings({ ...settings, customDict: nextCustom }, "词条已保存并生效");
  });

  els.dictSearch.addEventListener("input", renderDictList);

  els.exportBtn.addEventListener("click", () => {
    const data = JSON.stringify(settings.customDict || {}, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "figma-cn-custom-dict.json";
    a.click();
    URL.revokeObjectURL(url);
    showToast("已导出自定义词库");
  });

  els.importBtn.addEventListener("click", () => {
    els.importFile.click();
  });

  els.importFile.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || "{}"));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("invalid");
        }
        const merged = { ...(settings.customDict || {}) };
        let added = 0;
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof k === "string" && typeof v === "string" && k.trim() && v.trim()) {
            merged[k.trim()] = v.trim();
            added++;
          }
        }
        saveSettings({ ...settings, customDict: merged }, `已导入 ${added} 条词条`);
      } catch (_) {
        showToast("JSON 格式不正确，请检查文件");
      } finally {
        els.importFile.value = "";
      }
    };
    reader.readAsText(file);
  });

  els.clearCustomBtn.addEventListener("click", () => {
    const count = Object.keys(settings.customDict || {}).length;
    if (count === 0) return;
    if (!window.confirm(`确定要清空全部 ${count} 条自定义词条吗？`)) return;
    saveSettings({ ...settings, customDict: {} }, "已清空自定义词库");
  });

  // Init
  (async function init() {
    const res = await storageGet([STORAGE_KEY]);
    settings = {
      ...DEFAULT_SETTINGS,
      ...((res && res[STORAGE_KEY]) || {}),
      customDict: { ...((res && res[STORAGE_KEY] && res[STORAGE_KEY].customDict) || {}) }
    };
    renderUI();
    await refreshActiveTabStatus();
  })();
})();

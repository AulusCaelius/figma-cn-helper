(function () {
  "use strict";

  const STORAGE_KEY = "figmaCnSettings";
  const FIGMA_URL_RE = /^https:\/\/(?:www\.)?figma\.com(?:\/|$)/i;
  const DEFAULT_SETTINGS = {
    enabled: true,
    translateAttributes: true,
    protectUserContent: true,
    peekOriginalOnAlt: true
  };

  const els = {
    enabledToggle: document.getElementById("enabledToggle"),
    peekAltToggle: document.getElementById("peekAltToggle"),
    attrToggle: document.getElementById("attrToggle"),
    protectToggle: document.getElementById("protectToggle"),
    pageStatus: document.getElementById("pageStatus"),
    builtInCount: document.getElementById("builtInCount"),
    translatedCount: document.getElementById("translatedCount"),
    toast: document.getElementById("toast")
  };

  let settings = { ...DEFAULT_SETTINGS };
  let toastTimer = null;

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
      ...next
    };
    await storageSet({ [STORAGE_KEY]: settings });
    renderUI();
    if (toastMsg) showToast(toastMsg);
    setTimeout(() => {
      refreshActiveTabStatus();
    }, 120);
  }

  function renderUI() {
    els.enabledToggle.checked = Boolean(settings.enabled);
    els.peekAltToggle.checked = Boolean(settings.peekOriginalOnAlt);
    els.attrToggle.checked = Boolean(settings.translateAttributes);
    els.protectToggle.checked = Boolean(settings.protectUserContent);
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
      if (state === "NEED_RELOAD") {
        els.pageStatus.textContent = "请刷新当前 Figma 页面以激活汉化插件";
      } else {
        els.pageStatus.textContent = "当前标签页不是 Figma（请在 figma.com 使用）";
      }
      return;
    }

    els.translatedCount.textContent = String(resp.translatedCount || 0);
    els.pageStatus.textContent = resp.enabled
      ? "已连接 Figma 页面 · 实时汉化生效中"
      : "已连接 Figma 页面 · 当前为英文原版";
  }

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

  // Init
  (async function init() {
    const res = await storageGet([STORAGE_KEY]);
    settings = {
      ...DEFAULT_SETTINGS,
      ...((res && res[STORAGE_KEY]) || {})
    };
    renderUI();
    await refreshActiveTabStatus();
  })();
})();

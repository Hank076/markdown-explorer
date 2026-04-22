import { marked } from "./libs/marked/marked.esm.js";
import { splitDocumentLink, resolveWorkspacePath } from "./app/workspace/path-utils.js";
import { createAssetUrlRegistry, isWorkspaceRelativeHref, resolveAssetUrl } from "./app/workspace/assets.js";
import { buildDocumentRecord, searchDocumentIndex } from "./app/workspace/document-index.js";

// ── IndexedDB History Helpers ──────────────────────────────────────────────

const DB_NAME = "markdown-explorer-db";
const DB_STORE = "history";
const HISTORY_MAX_FOLDERS = 5;
const HISTORY_MAX_FILES = 10;

let _dbConnection = null;
function initDB() {
  if (_dbConnection) return Promise.resolve(_dbConnection);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE, { keyPath: "folderName" });
      }
    };
    req.onsuccess = (e) => { _dbConnection = e.target.result; resolve(_dbConnection); };
    req.onerror = () => reject(req.error);
  });
}

async function saveHistory(folderName, handle, recentFiles = []) {
  try {
    const db = await initDB();
    const tx = db.transaction(DB_STORE, "readwrite");
    const store = tx.objectStore(DB_STORE);
    const existing = await new Promise((res) => {
      const r = store.get(folderName);
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    const merged = existing ? existing.recentFiles : [];
    for (const f of recentFiles) {
      const idx = merged.findIndex((x) => x.path === f.path);
      if (idx >= 0) merged.splice(idx, 1);
      merged.unshift(f);
    }
    const record = {
      folderName,
      handle,
      recentFiles: merged.slice(0, HISTORY_MAX_FILES),
      lastOpened: Date.now(),
    };
    store.put(record);
    await new Promise((res, rej) => {
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
    // Trim to max folders
    await trimHistory();
    renderSidebarRecentPanel();
  } catch (err) {
    console.warn("[history] saveHistory failed:", err);
  }
}

async function trimHistory() {
  try {
    const db = await initDB();
    const tx = db.transaction(DB_STORE, "readwrite");
    const store = tx.objectStore(DB_STORE);
    const all = await new Promise((res) => {
      const r = store.getAll();
      r.onsuccess = () => res(r.result);
      r.onerror = () => res([]);
    });
    if (all.length <= HISTORY_MAX_FOLDERS) return;
    all.sort((a, b) => b.lastOpened - a.lastOpened);
    const toDelete = all.slice(HISTORY_MAX_FOLDERS);
    for (const item of toDelete) store.delete(item.folderName);
    await new Promise((res, rej) => {
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
  } catch (err) {
    console.warn("[history] trimHistory failed:", err);
  }
}

async function loadHistory() {
  try {
    const db = await initDB();
    const tx = db.transaction(DB_STORE, "readonly");
    const store = tx.objectStore(DB_STORE);
    const all = await new Promise((res) => {
      const r = store.getAll();
      r.onsuccess = () => res(r.result);
      r.onerror = () => res([]);
    });
    all.sort((a, b) => b.lastOpened - a.lastOpened);
    return all.slice(0, HISTORY_MAX_FOLDERS);
  } catch (err) {
    console.warn("[history] loadHistory failed:", err);
    return [];
  }
}

// ── End IndexedDB History Helpers ──────────────────────────────────────────

const openFolderButton = document.getElementById("open-folder");
const themeToggle = document.getElementById("theme-toggle");
const sidebarToggle = document.getElementById("sidebar-toggle");
const treeEl = document.getElementById("tree");
const tabsEl = document.getElementById("tabs");
const previewEl = document.getElementById("preview");
const tocEl = document.getElementById("toc");
const tocContentEl = tocEl?.querySelector(".toc-content");
const tocListContainer = document.getElementById("toc-list-container");
const tocToggleBtn = document.getElementById("toc-toggle");
const viewerContainer = document.getElementById("viewer-container");
const emptyEl = document.getElementById("empty");
const statusText = document.getElementById("status-text");
const closeAllTabsBtn = document.getElementById("close-all-tabs");
const appEl = document.querySelector(".app");
const sidebarEl = document.querySelector(".sidebar");
const resizerEl = document.querySelector(".sidebar-resizer");
const viewerEl = document.querySelector(".viewer");
const workspaceEl = document.querySelector(".workspace");
const rootEl = document.documentElement;
const searchShellEl = document.querySelector(".search-shell");

const settingsToggle = document.getElementById("settings-toggle");
const langToggle = document.getElementById("lang-toggle");
const mathRendererSelect = document.getElementById("math-renderer");
const settingsDialog = document.getElementById("settings-dialog");
const settingsCloseButton = document.getElementById("settings-close");
const recentPanelEl = document.getElementById("recent-panel");
const recentPanelToggleBtn = document.getElementById("recent-panel-toggle");
const recentPanelBodyEl = document.getElementById("recent-panel-body");
const workspaceSearchInput = document.getElementById("workspace-search");
const workspaceSearchLabel = document.getElementById("workspace-search-label");
const searchResultsEl = document.getElementById("search-results");
const searchResultsLabel = document.getElementById("search-results-label");
const mathRendererLabelEl = document.getElementById("math-renderer-label");
const settingsTitleEl = document.getElementById("settings-title");
const settingsDescriptionEl = document.getElementById("settings-description");
const settingsRenderingTitleEl = document.getElementById("settings-rendering-title");
const settingsRenderingDescriptionEl = document.getElementById("settings-rendering-description");
const fontTitleEl = document.getElementById("settings-font-title");
const fontDescriptionEl = document.getElementById("settings-font-description");
const fontBtns = document.querySelectorAll(".font-control-btn[data-font]");
const fontSizeTitleEl = document.getElementById("settings-fontsize-title");
const fontSizeDescriptionEl = document.getElementById("settings-fontsize-description");
const fontSizeBtns = document.querySelectorAll(".font-control-btn[data-font-size]");

const langStorageKey = "markdown-explorer-lang";
const mathRendererStorageKey = "markdown-explorer-math-renderer";
const proseFontStorageKey = "markdown-explorer-prose-font";
const fontSizeStorageKey = "markdown-explorer-font-size";
const langTagMap = { "zh-TW": "zh-Hant-TW", en: "en" };
const MATH_RENDERERS = Object.freeze({ katex: "katex", mathjax: "mathjax" });
let currentLang = localStorage.getItem(langStorageKey) || "zh-TW";
let currentMathRenderer = normalizeMathRenderer(localStorage.getItem(mathRendererStorageKey));
let translations = {};

function normalizeMathRenderer(value) {
  return value === MATH_RENDERERS.mathjax ? MATH_RENDERERS.mathjax : MATH_RENDERERS.katex;
}

const FONT_STACKS = Object.freeze({
  default: '"Iosevka Aile", "Cascadia Code", "Segoe UI", sans-serif',
  system: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
});
const FONT_SIZES = Object.freeze({ "14": "14", "16": "16", "18": "18", "20": "20" });

function normalizeProseFont(value) {
  return FONT_STACKS[value] ? value : "default";
}

function normalizeFontSize(value) {
  return FONT_SIZES[value] ?? "16";
}

let currentProseFont = normalizeProseFont(localStorage.getItem(proseFontStorageKey));
let currentFontSize = normalizeFontSize(localStorage.getItem(fontSizeStorageKey));

async function loadLocale(lang) {
  try {
    const res = await fetch(`locales/${lang}.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    translations = await res.json();
  } catch (err) {
    console.warn(`[i18n] Failed to load locale "${lang}":`, err);
    if (Object.keys(translations).length === 0 && lang !== "zh-TW") {
      try {
        const fallback = await fetch("locales/zh-TW.json");
        if (fallback.ok) translations = await fallback.json();
      } catch { }
    }
  }
}

function t(key, vars = {}) {
  let str = translations[key] ?? key;
  for (const [k, v] of Object.entries(vars)) {
    str = str.replaceAll(`{${k}}`, String(v));
  }
  return str;
}

function applyLocale(lang) {
  document.documentElement.lang = langTagMap[lang] || lang;

  const openFolderLabel = document.getElementById("open-folder-label");
  if (openFolderLabel) openFolderLabel.textContent = t("btn.openFolder");

  const hintEl = document.querySelector(".sidebar-footer .hint");
  if (hintEl) hintEl.textContent = t("sidebar.hint");

  const copyrightEl = document.querySelector(".sidebar-footer .copyright");
  if (copyrightEl) copyrightEl.textContent = t("sidebar.copyright");

  const emptyTitle = document.getElementById("empty-title");
  if (emptyTitle) emptyTitle.textContent = t("empty.title");

  const emptyDesc = document.getElementById("empty-desc");
  if (emptyDesc) emptyDesc.textContent = t("empty.desc");

  const f1 = document.getElementById("empty-feature1");
  if (f1) f1.textContent = t("empty.feature1");

  const f2 = document.getElementById("empty-feature2");
  if (f2) f2.textContent = t("empty.feature2");

  const f3 = document.getElementById("empty-feature3");
  if (f3) f3.textContent = t("empty.feature3");

  if (sidebarEl) sidebarEl.setAttribute("aria-label", t("aria.sidebar"));
  if (tabsEl) tabsEl.setAttribute("aria-label", t("aria.tabs"));
  if (previewEl) previewEl.setAttribute("aria-label", t("aria.preview"));
  if (tocEl) tocEl.setAttribute("aria-label", t("toc.title"));

  const tocTitleEl = tocEl?.querySelector(".toc-title");
  if (tocTitleEl) tocTitleEl.textContent = t("toc.title");

  const tocCollapsedLabel = document.getElementById("toc-collapsed-label");
  if (tocCollapsedLabel) tocCollapsedLabel.textContent = t("toc.title");

  if (tocToggleBtn) {
    const isCollapsed = tocEl.classList.contains("collapsed");
    tocToggleBtn.setAttribute("aria-label", isCollapsed ? t("aria.tocExpand") : t("aria.tocCollapse"));
    tocToggleBtn.innerHTML = isCollapsed ? ICON_TOC_OPEN : ICON_TOC_CLOSE;
  }

  const currentTheme = rootEl.getAttribute("data-theme");
  if (themeToggle && currentTheme) {
    themeToggle.setAttribute("aria-label", currentTheme === "dark" ? t("aria.themeToLight") : t("aria.themeToDark"));
  }

  if (settingsToggle) {
    settingsToggle.setAttribute("aria-label", t("aria.settingsOpen"));
    settingsToggle.innerHTML = ICON_SETTINGS;
  }

  if (settingsCloseButton) {
    settingsCloseButton.setAttribute("aria-label", t("aria.settingsClose"));
    settingsCloseButton.innerHTML = "×";
  }

  if (langToggle) {
    langToggle.textContent = t("lang.current");
    langToggle.setAttribute("aria-label", t("lang.switchLabel"));
    langToggle.setAttribute("aria-pressed", lang === "en" ? "true" : "false");
  }

  if (!rootHandle) statusText.textContent = t("status.waiting");
  if (closeAllTabsBtn) {
    closeAllTabsBtn.textContent = t("tab.closeAll");
    closeAllTabsBtn.setAttribute("aria-label", t("aria.closeAllTabs"));
  }

  const recentTitleEl = emptyEl?.querySelector(".recent-title");
  if (recentTitleEl) recentTitleEl.textContent = t("recent.title");

  const recentPanelLabelEl = document.getElementById("recent-panel-label");
  if (recentPanelLabelEl) recentPanelLabelEl.textContent = t("sidebar.recentPanel");

  if (workspaceEl) workspaceEl.dataset.dragHint = t("dragdrop.hint");
  if (workspaceSearchInput) {
    workspaceSearchInput.placeholder = t("search.placeholder");
    workspaceSearchInput.setAttribute("aria-label", t("search.label"));
  }

  if (workspaceSearchLabel) {
    workspaceSearchLabel.textContent = t("search.label");
  }

  if (searchResultsLabel) {
    searchResultsLabel.textContent = t("search.results");
  }

  if (mathRendererLabelEl) {
    mathRendererLabelEl.textContent = t("math.rendererLabel");
  }

  if (settingsTitleEl) {
    settingsTitleEl.textContent = t("settings.title");
  }

  if (settingsDescriptionEl) {
    settingsDescriptionEl.textContent = t("settings.description");
  }

  if (settingsRenderingTitleEl) {
    settingsRenderingTitleEl.textContent = t("settings.renderingTitle");
  }

  if (settingsRenderingDescriptionEl) {
    settingsRenderingDescriptionEl.textContent = t("settings.renderingDescription");
  }
  if (fontTitleEl) fontTitleEl.textContent = t("settings.font.title");
  if (fontDescriptionEl) fontDescriptionEl.textContent = t("settings.font.description");
  const fontBtnDefault = document.getElementById("font-btn-default");
  const fontBtnSystem = document.getElementById("font-btn-system");
  const fontBtnSerif = document.getElementById("font-btn-serif");
  if (fontBtnDefault) fontBtnDefault.textContent = t("settings.font.default");
  if (fontBtnSystem) fontBtnSystem.textContent = t("settings.font.system");
  if (fontBtnSerif) fontBtnSerif.textContent = t("settings.font.serif");
  if (fontSizeTitleEl) fontSizeTitleEl.textContent = t("settings.fontSize.title");
  if (fontSizeDescriptionEl) fontSizeDescriptionEl.textContent = t("settings.fontSize.description");
  const fontSizeBtnSm = document.getElementById("font-size-btn-sm");
  const fontSizeBtnMd = document.getElementById("font-size-btn-md");
  const fontSizeBtnLg = document.getElementById("font-size-btn-lg");
  const fontSizeBtnXl = document.getElementById("font-size-btn-xl");
  if (fontSizeBtnSm) fontSizeBtnSm.textContent = t("settings.fontSize.sm");
  if (fontSizeBtnMd) fontSizeBtnMd.textContent = t("settings.fontSize.md");
  if (fontSizeBtnLg) fontSizeBtnLg.textContent = t("settings.fontSize.lg");
  if (fontSizeBtnXl) fontSizeBtnXl.textContent = t("settings.fontSize.xl");

  if (mathRendererSelect) {
    mathRendererSelect.setAttribute("aria-label", t("math.rendererAria"));
    const katexOption = mathRendererSelect.querySelector('option[value="katex"]');
    const mathJaxOption = mathRendererSelect.querySelector('option[value="mathjax"]');
    if (katexOption) katexOption.textContent = t("math.katex");
    if (mathJaxOption) mathJaxOption.textContent = t("math.mathjax");
    mathRendererSelect.value = currentMathRenderer;
  }

  renderSearchResults(currentSearchResults);
}

async function setLang(lang) {
  currentLang = lang;
  localStorage.setItem(langStorageKey, lang);
  await loadLocale(lang);
  applyLocale(lang);
  applyTheme(rootEl.getAttribute("data-theme") || getPreferredTheme());
  if (sidebarToggle) {
    const isCollapsed = appEl.classList.contains("sidebar-collapsed");
    sidebarToggle.setAttribute("aria-label", isCollapsed ? t("aria.sidebarExpand") : t("aria.sidebarCollapse"));
  }
  renderTabs();
}

let rootHandle = null;
let activePath = null;
let cachedHeadings = [];
let tocRAFPending = false;
let activeTreeNode = null;
let pendingAnchor = "";
const handleMap = new Map();
const openFiles = new Map();
const openOrder = [];
const scrollPositions = new Map();
const previewAssets = createAssetUrlRegistry();
let draggedTabPath = null;
let dragTargetTabPath = null;
let dragTargetPosition = null;
let searchQuery = "";
let currentSearchResults = { files: [], headings: [], content: [] };
let indexBuildToken = 0;
const documentIndex = new Map();
let idSeed = 0;

function slugifyHeading(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

marked.use({
  renderer: {
    html() { return ""; },
    heading({ tokens, depth, text }) {
      const id = slugifyHeading(text);
      const inner = this.parser.parseInline(tokens);
      return `<h${depth} id="${id}">${inner}</h${depth}>\n`;
    },
    link({ href, title, text }) {
      const safeTitle = title ? ` title="${title}"` : "";
      if (href && href.startsWith("#")) {
        return `<a href="${href}" class="anchor-link"${safeTitle}>${text}</a>`;
      }
      if (href && !/^(https?:\/\/|\/\/|mailto:)/.test(href)) {
        return `<a href="${href}" class="internal-link" data-href="${href}"${safeTitle}>${text}</a>`;
      }
      return `<a href="${href}" target="_blank" rel="noopener noreferrer"${safeTitle}>${text}</a>`;
    },
  },
});

let mermaidApi = window.mermaid ?? null;
let prismApi = window.Prism ?? null;
let katexApi = window.katex ?? null;
let katexAutoRender = window.renderMathInElement ?? null;
let mathJaxApi = window.MathJax?.typesetPromise ? window.MathJax : null;
const themeStorageKey = "markdown-explorer-theme";
const sidebarWidthStorageKey = "markdown-explorer-sidebar-width";
let mermaidLoadPromise = null;
let prismLoadPromise = null;
let katexLoadPromise = null;
let mathJaxLoadPromise = null;
let mathJaxTypesetPromise = Promise.resolve();
let renderPreviewToken = 0;

const ICON_SUN = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;
const ICON_MOON = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
const ICON_SETTINGS = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c0 .66.39 1.26 1 1.51H21a2 2 0 1 1 0 4h-.09c-.66 0-1.26.39-1.51 1Z"/></svg>`;
const ICON_PANEL_CLOSE = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><line x1="9" x2="9" y1="3" y2="21"/><path d="m16 15-3-3 3-3"/></svg>`;
const ICON_PANEL_OPEN = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><line x1="9" x2="9" y1="3" y2="21"/><path d="m12 9 3 3-3 3"/></svg>`;
const ICON_TOC_CLOSE = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>`;
const ICON_TOC_OPEN = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>`;

function getPreferredTheme() {
  const stored = localStorage.getItem(themeStorageKey);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyProseFont(fontKey) {
  const stack = FONT_STACKS[fontKey] ?? FONT_STACKS.default;
  rootEl.style.setProperty("--prose-font-body", stack);
  rootEl.style.setProperty("--prose-font-heading", stack);
  fontBtns.forEach((btn) => {
    btn.classList.toggle("is-selected", btn.dataset.font === fontKey);
  });
}

function applyFontSize(size) {
  rootEl.style.setProperty("--prose-font-size", `${size}px`);
  fontSizeBtns.forEach((btn) => {
    btn.classList.toggle("is-selected", btn.dataset.fontSize === size);
  });
}

function applyTheme(theme) {
  rootEl.setAttribute("data-theme", theme);
  if (themeToggle) {
    themeToggle.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
    themeToggle.setAttribute("aria-label", theme === "dark" ? t("aria.themeToLight") : t("aria.themeToDark"));
    themeToggle.innerHTML = theme === "dark" ? ICON_SUN : ICON_MOON;
  }
}

function getMermaidTheme() { return rootEl.getAttribute("data-theme") === "dark" ? "dark" : "neutral"; }

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-dynamic-src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === "true") {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.dynamicSrc = src;
    script.addEventListener("load", () => {
      script.dataset.loaded = "true";
      resolve();
    }, { once: true });
    script.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), { once: true });
    document.head.appendChild(script);
  });
}

function loadStylesheetOnce(href) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`link[data-dynamic-href="${href}"]`);
    if (existing) {
      if (existing.dataset.loaded === "true") {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error(`Failed to load ${href}`)), { once: true });
      return;
    }

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.dataset.dynamicHref = href;
    link.addEventListener("load", () => {
      link.dataset.loaded = "true";
      resolve();
    }, { once: true });
    link.addEventListener("error", () => reject(new Error(`Failed to load ${href}`)), { once: true });
    document.head.appendChild(link);
  });
}

async function ensurePrismLoaded() {
  if (prismApi) return prismApi;
  if (!prismLoadPromise) {
    prismLoadPromise = loadScriptOnce("libs/prism/prism.js").then(() => {
      prismApi = window.Prism ?? null;
      return prismApi;
    });
  }
  return prismLoadPromise;
}

async function ensureMermaidLoaded() {
  if (mermaidApi) return mermaidApi;
  if (!mermaidLoadPromise) {
    mermaidLoadPromise = loadScriptOnce("libs/mermaid/mermaid.min.js").then(() => {
      mermaidApi = window.mermaid ?? null;
      initMermaid();
      return mermaidApi;
    });
  }
  return mermaidLoadPromise;
}

async function ensureKatexLoaded() {
  if (katexApi && katexAutoRender) {
    return { katex: katexApi, renderMathInElement: katexAutoRender };
  }
  if (!katexLoadPromise) {
    katexLoadPromise = loadStylesheetOnce("libs/katex/katex.min.css")
      .then(() => loadScriptOnce("libs/katex/katex.min.js"))
      .then(() => loadScriptOnce("libs/katex/contrib/auto-render.min.js"))
      .then(() => {
        katexApi = window.katex ?? null;
        katexAutoRender = window.renderMathInElement ?? null;
        return { katex: katexApi, renderMathInElement: katexAutoRender };
      });
  }
  return katexLoadPromise;
}

function getMathJaxConfig() {
  return {
    tex: {
      inlineMath: [["$", "$"], ["\\(", "\\)"]],
      displayMath: [["$$", "$$"], ["\\[", "\\]"]],
      processEscapes: true,
    },
    svg: {
      fontCache: "local",
    },
    options: {
      skipHtmlTags: ["script", "noscript", "style", "textarea", "pre", "code", "option"],
    },
    startup: {
      typeset: false,
    },
  };
}

async function ensureMathJaxLoaded() {
  if (mathJaxApi?.typesetPromise) return mathJaxApi;
  if (!mathJaxLoadPromise) {
    mathJaxLoadPromise = (async () => {
      const config = getMathJaxConfig();
      window.MathJax = {
        ...(window.MathJax ?? {}),
        ...config,
        tex: {
          ...(window.MathJax?.tex ?? {}),
          ...config.tex,
        },
        svg: {
          ...(window.MathJax?.svg ?? {}),
          ...config.svg,
        },
        options: {
          ...(window.MathJax?.options ?? {}),
          ...config.options,
        },
        startup: {
          ...(window.MathJax?.startup ?? {}),
          ...config.startup,
        },
      };
      await loadScriptOnce("libs/mathjax/tex-svg.js");
      mathJaxApi = window.MathJax?.typesetPromise ? window.MathJax : null;
      return mathJaxApi;
    })();
  }
  return mathJaxLoadPromise;
}

function containsMathSyntax(text) {
  return /(^|[^\\])\$\$|(^|[^\\])\$[^\s$]|\\\(|\\\[/.test(text);
}

function getMathDelimiters() {
  return [
    { left: "$$", right: "$$", display: true },
    { left: "\\[", right: "\\]", display: true },
    { left: "$", right: "$", display: false },
    { left: "\\(", right: "\\)", display: false },
  ];
}

async function renderMathWithKatex(container) {
  const katex = await ensureKatexLoaded();
  katex.renderMathInElement?.(container, {
    delimiters: getMathDelimiters(),
    ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code", "option"],
    throwOnError: false,
    strict: "ignore",
  });
}

async function renderMathWithMathJax(container) {
  const mathJax = await ensureMathJaxLoaded();
  if (!mathJax?.typesetPromise) return;
  mathJaxTypesetPromise = mathJaxTypesetPromise
    .catch(() => {})
    .then(() => mathJax.typesetPromise([container]));
  await mathJaxTypesetPromise;
}

async function renderMath(container) {
  if (currentMathRenderer === MATH_RENDERERS.mathjax) {
    await renderMathWithMathJax(container);
    return;
  }
  await renderMathWithKatex(container);
}

function initMermaid() {
  if (mermaidApi) {
    mermaidApi.initialize({ startOnLoad: false, theme: getMermaidTheme(), securityLevel: "strict" });
  }
}

function setMathRenderer(renderer) {
  const nextRenderer = normalizeMathRenderer(renderer);
  currentMathRenderer = nextRenderer;
  localStorage.setItem(mathRendererStorageKey, nextRenderer);
  if (mathRendererSelect) {
    mathRendererSelect.value = nextRenderer;
  }
  if (activePath) {
    scrollPositions.set(activePath, viewerEl.scrollTop);
    void renderPreview();
  }
}

function openSettingsDialog() {
  if (!settingsDialog) return;
  if (settingsDialog.open) return;
  if (typeof settingsDialog.showModal === "function") {
    settingsDialog.showModal();
  } else {
    settingsDialog.setAttribute("open", "");
  }
  if (settingsToggle) {
    settingsToggle.setAttribute("aria-pressed", "true");
  }
}

function closeSettingsDialog() {
  if (!settingsDialog) return;
  if (typeof settingsDialog.close === "function") {
    settingsDialog.close();
  } else {
    settingsDialog.removeAttribute("open");
  }
}

function setStatus(text, loading = false) {
  statusText.textContent = text;
  statusText.classList.toggle("loading", loading);
}

function showToast(message) {
  const existing = document.getElementById("toast");
  if (existing) existing.remove();
  const toast = document.createElement("div");
  toast.id = "toast";
  toast.className = "toast";
  toast.setAttribute("role", "alert");
  toast.setAttribute("aria-live", "assertive");
  const msg = document.createElement("span");
  msg.className = "toast-message";
  msg.textContent = message;
  const closeBtn = document.createElement("button");
  closeBtn.className = "toast-close";
  closeBtn.setAttribute("aria-label", t("aria.toastClose") || "關閉通知");
  closeBtn.textContent = "×";
  closeBtn.addEventListener("click", () => toast.remove());
  toast.appendChild(msg);
  toast.appendChild(closeBtn);
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

function setPreviewVisible(isVisible) {
  viewerContainer.hidden = !isVisible;
  previewEl.style.display = isVisible ? "block" : "none";
  emptyEl.style.display = isVisible ? "none" : "flex";
  if (!isVisible) renderRecentHistory();
}

async function restoreFolder(record) {
  try {
    const permission = await record.handle.queryPermission({ mode: "read" });
    if (permission !== "granted") {
      const result = await record.handle.requestPermission({ mode: "read" });
      if (result !== "granted") {
        showToast(t("recent.permissionDenied"));
        return false;
      }
    }
    rootHandle = record.handle;
    openFiles.clear();
    openOrder.length = 0;
    activePath = null;
    await renderTree();
    await saveHistory(record.folderName, record.handle);
    return true;
  } catch {
    showToast(t("recent.folderNotFound"));
    return false;
  }
}

function buildRecentHistoryContent(history, { isSidebar = false } = {}) {
  const fragment = document.createDocumentFragment();
  const ul = document.createElement("ul");
  ul.className = "recent-list";

  for (const record of history) {
    const li = document.createElement("li");
    li.className = "recent-folder-item";

    const folderBtn = document.createElement("button");
    folderBtn.className = "recent-folder-btn";
    folderBtn.type = "button";
    folderBtn.textContent = `📁 ${record.folderName}`;
    folderBtn.addEventListener("click", async () => {
      if (isSidebar && rootHandle && rootHandle.name === record.folderName) return;
      folderBtn.disabled = true;
      const ok = await restoreFolder(record);
      if (!ok) folderBtn.disabled = false;
    });
    li.appendChild(folderBtn);

    if (record.recentFiles && record.recentFiles.length > 0) {
      const filesUl = document.createElement("ul");
      filesUl.className = "recent-files-list";
      for (const f of record.recentFiles) {
        const fileLi = document.createElement("li");
        const fileBtn = document.createElement("button");
        fileBtn.className = "recent-file-btn";
        fileBtn.type = "button";
        fileBtn.dataset.path = f.path;
        const dirPart = f.path.includes("/") ? f.path.substring(0, f.path.lastIndexOf("/") + 1) : "";
        const nameSpan = document.createElement("span");
        nameSpan.className = "recent-file-name";
        nameSpan.textContent = `📄 ${f.name}`;
        fileBtn.appendChild(nameSpan);
        if (dirPart) {
          const dirSpan = document.createElement("span");
          dirSpan.className = "recent-file-dir";
          dirSpan.textContent = dirPart;
          fileBtn.appendChild(dirSpan);
        }
        fileBtn.addEventListener("click", async () => {
          fileBtn.disabled = true;
          if (isSidebar && rootHandle && rootHandle.name === record.folderName) {
            // 同資料夾，直接開檔
            const fileHandle = await findFileHandle(f.path);
            if (fileHandle) {
              await openFile(fileHandle, f.path, null);
            } else {
              showToast(t("alert.fileNotFound", { path: f.path }));
              fileBtn.disabled = false;
            }
            return;
          }
          const ok = await restoreFolder(record);
          if (!ok) { fileBtn.disabled = false; return; }
          const fileHandle = await findFileHandle(f.path);
          if (fileHandle) {
            await openFile(fileHandle, f.path, null);
          } else {
            showToast(t("alert.fileNotFound", { path: f.path }));
          }
        });
        fileLi.appendChild(fileBtn);
        filesUl.appendChild(fileLi);
      }
      li.appendChild(filesUl);
    }

    ul.appendChild(li);
  }

  fragment.appendChild(ul);
  return fragment;
}

async function renderRecentHistory() {
  const existing = emptyEl.querySelector(".recent-history");
  if (existing) existing.remove();

  const history = await loadHistory();
  if (history.length === 0) {
    emptyEl.classList.remove("has-history");
    return;
  }
  emptyEl.classList.add("has-history");

  const section = document.createElement("div");
  section.className = "recent-history";

  const title = document.createElement("h3");
  title.className = "recent-title";
  title.textContent = t("recent.title");
  section.appendChild(title);

  section.appendChild(buildRecentHistoryContent(history));
  emptyEl.appendChild(section);
}

async function renderSidebarRecentPanel() {
  if (!recentPanelEl || !recentPanelBodyEl) return;

  const history = await loadHistory();
  if (history.length === 0) {
    recentPanelEl.hidden = true;
    return;
  }
  recentPanelEl.hidden = false;
  recentPanelBodyEl.innerHTML = "";
  recentPanelBodyEl.appendChild(buildRecentHistoryContent(history, { isSidebar: true }));
}

function generateTOC() {
  if (!tocEl || !tocListContainer) return;
  const headings = Array.from(previewEl.querySelectorAll("h1, h2, h3, h4"));
  cachedHeadings = headings;
  tocListContainer.innerHTML = "";

  if (headings.length === 0) {
    tocEl.style.display = "none";
    return;
  }
  tocEl.style.display = "flex";

  const list = document.createElement("ul");
  list.className = "toc-list";

  headings.forEach((heading, index) => {
    const id = heading.id || `heading-${index}`;
    heading.id = id;
    const level = parseInt(heading.tagName[1]);
    const item = document.createElement("li");
    item.className = "toc-item";
    item.dataset.level = level;
    const link = document.createElement("a");
    link.className = "toc-link";
    link.href = `#${id}`;
    link.textContent = heading.textContent;
    link.title = heading.textContent;
    link.addEventListener("click", (e) => {
      e.preventDefault();
      heading.scrollIntoView({ behavior: "smooth" });
    });
    item.appendChild(link);
    list.appendChild(item);
  });
  tocListContainer.appendChild(list);
  updateTOCActive();
}

function setTOCCollapsed(collapsed) {
  if (!tocEl) return;
  tocEl.classList.toggle("collapsed", collapsed);
  if (tocToggleBtn) {
    tocToggleBtn.setAttribute("aria-pressed", collapsed ? "true" : "false");
    tocToggleBtn.setAttribute("aria-label", collapsed ? t("aria.tocExpand") : t("aria.tocCollapse"));
    tocToggleBtn.innerHTML = collapsed ? ICON_TOC_OPEN : ICON_TOC_CLOSE;
  }
}

function updateTOCActive() {
  if (!tocEl || tocEl.classList.contains("collapsed") || tocEl.style.display === "none") return;
  if (tocRAFPending) return;
  tocRAFPending = true;
  requestAnimationFrame(() => {
    tocRAFPending = false;
    const scrollPos = viewerEl.scrollTop + 64;
    let activeId = null;
    for (const heading of cachedHeadings) {
      if (heading.offsetTop <= scrollPos) activeId = heading.id;
      else break;
    }
    tocEl.querySelectorAll(".toc-link").forEach((link) => {
      const isActive = link.getAttribute("href") === `#${activeId}`;
      link.classList.toggle("active", isActive);
      if (isActive && tocContentEl) {
        const linkRect = link.getBoundingClientRect();
        const containerRect = tocContentEl.getBoundingClientRect();
        if (linkRect.top < containerRect.top || linkRect.bottom > containerRect.bottom) {
          tocContentEl.scrollTop += linkRect.top - containerRect.top - containerRect.height / 2 + linkRect.height / 2;
        }
      }
    });
  });
}

function makeId() { idSeed += 1; return `node-${idSeed}`; }

async function readDirectoryEntries(dirHandle) {
  const entries = [];
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === "file" && !name.toLowerCase().endsWith(".md")) continue;
    entries.push({ name, handle, kind: handle.kind });
  }
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name, "zh-Hant");
  });
  return entries;
}

async function collectMarkdownPaths(dirHandle, prefix = "") {
  const records = [];

  for await (const [name, handle] of dirHandle.entries()) {
    const path = `${prefix}${name}`;
    if (handle.kind === "directory") {
      records.push(...(await collectMarkdownPaths(handle, `${path}/`)));
      continue;
    }
    if (name.toLowerCase().endsWith(".md")) {
      records.push({ path, handle });
    }
  }

  return records;
}

function runSearch(query) {
  searchQuery = query;
  currentSearchResults = searchDocumentIndex([...documentIndex.values()], query);
  renderSearchResults(currentSearchResults);
}

async function buildWorkspaceIndex() {
  if (!rootHandle) {
    return;
  }

  const token = ++indexBuildToken;
  documentIndex.clear();
  setStatus(t("status.indexing"), true);
  try {
    const files = await collectMarkdownPaths(rootHandle);

    for (const entry of files) {
      if (token !== indexBuildToken) {
        return;
      }

      const file = await entry.handle.getFile();
      const content = await file.text();
      documentIndex.set(entry.path, buildDocumentRecord({ path: entry.path, content }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } catch (error) {
    if (token === indexBuildToken) {
      console.warn("[index] Failed to build workspace index:", error);
    }
  } finally {
    if (token !== indexBuildToken) {
      return;
    }

    setStatus(t("status.ready"));
    runSearch(searchQuery);
  }
}

function hideSearchResults() {
  if (!searchResultsEl) {
    return;
  }

  searchResultsEl.hidden = true;
  searchResultsEl.replaceChildren();
  if (searchResultsLabel) {
    searchResultsEl.appendChild(searchResultsLabel);
  }
}

function createSearchResultButton({ title, path, meta = "", onClick }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "search-result-link";

  const titleEl = document.createElement("span");
  titleEl.className = "search-result-title";
  titleEl.textContent = title;

  const pathEl = document.createElement("span");
  pathEl.className = "search-result-path";
  pathEl.textContent = path;

  button.append(titleEl, pathEl);

  if (meta) {
    const metaEl = document.createElement("span");
    metaEl.className = "search-result-meta";
    metaEl.textContent = meta;
    button.appendChild(metaEl);
  }

  button.addEventListener("click", onClick);
  return button;
}

async function openSearchResult(path, anchor = "") {
  if (!rootHandle) {
    return;
  }

  const fileHandle = await findFileHandle(path);
  if (!fileHandle) {
    alert(t("alert.fileNotFound", { path }));
    return;
  }

  pendingAnchor = anchor;
  await openFile(fileHandle, path, null);
  hideSearchResults();
}

function renderSearchGroup(title, items) {
  const group = document.createElement("section");
  group.className = "search-result-group";

  const heading = document.createElement("h2");
  heading.className = "search-result-group-title";
  heading.textContent = title;
  group.appendChild(heading);

  if (items.length === 0) {
    const empty = document.createElement("p");
    empty.className = "search-result-empty";
    empty.textContent = t("search.empty");
    group.appendChild(empty);
    return group;
  }

  const list = document.createElement("div");
  list.className = "search-result-list";
  items.forEach((item) => list.appendChild(item));
  group.appendChild(list);
  return group;
}

function renderSearchResults(results) {
  if (!searchResultsEl) {
    return;
  }

  if (!searchQuery.trim()) {
    hideSearchResults();
    return;
  }

  searchResultsEl.hidden = false;
  searchResultsEl.replaceChildren();
  if (searchResultsLabel) {
    searchResultsEl.appendChild(searchResultsLabel);
  }

  const fileItems = results.files.map((record) =>
    createSearchResultButton({
      title: record.name,
      path: record.path,
      onClick: () => {
        void openSearchResult(record.path);
      },
    })
  );

  const headingItems = results.headings.map(({ path, heading }) =>
    createSearchResultButton({
      title: heading.text,
      path,
      meta: `#${heading.id}`,
      onClick: () => {
        void openSearchResult(path, heading.id);
      },
    })
  );

  const contentItems = results.content.map(({ path, excerpt }) =>
    createSearchResultButton({
      title: path.split("/").at(-1) || path,
      path,
      meta: excerpt,
      onClick: () => {
        void openSearchResult(path);
      },
    })
  );

  const groups = [
    fileItems.length > 0 ? renderSearchGroup(t("search.files"), fileItems) : null,
    headingItems.length > 0 ? renderSearchGroup(t("search.headings"), headingItems) : null,
    contentItems.length > 0 ? renderSearchGroup(t("search.content"), contentItems) : null,
  ].filter(Boolean);

  if (groups.length === 0) {
    const empty = document.createElement("p");
    empty.className = "search-result-empty";
    empty.textContent = t("search.empty");
    searchResultsEl.appendChild(empty);
    return;
  }

  searchResultsEl.append(...groups);
}

function assignRenderedHeadingIds(record) {
  if (!record) {
    return;
  }

  const headingEls = [...previewEl.querySelectorAll("h1, h2, h3, h4")];
  headingEls.forEach((headingEl, index) => {
    const heading = record.headings[index];
    if (!heading) {
      return;
    }
    headingEl.id = heading.id;
  });
}

function applyPendingAnchor() {
  if (!pendingAnchor) {
    return false;
  }

  const escapedAnchor =
    typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(pendingAnchor)
      : pendingAnchor.replace(/"/g, '\\"');
  const target = previewEl.querySelector(`#${escapedAnchor}`);
  if (!target) {
    const missingAnchor = pendingAnchor;
    pendingAnchor = "";
    alert(t("alert.anchorNotFound", { path: `${activePath || ""}#${missingAnchor}` }));
    return false;
  }

  pendingAnchor = "";
  requestAnimationFrame(() => {
    target.scrollIntoView({ block: "start" });
  });
  return true;
}

function createNodeButton(label, icon, depth = 0) {
  const button = document.createElement("button");
  button.className = "node";
  button.style.paddingLeft = `${8 + depth * 12}px`;
  button.title = label;
  button.innerHTML = `<span class="icon">${icon}</span><span class="label">${label}</span>`;
  return button;
}

function renderTreeNode(parentEl, entry, depth, parentPath) {
  const nodeId = makeId();
  const currentPath = `${parentPath}${entry.name}`;
  handleMap.set(nodeId, entry.handle);

  if (entry.kind === "directory") {
    const wrapper = document.createElement("div");
    wrapper.className = "tree-entry";
    const button = createNodeButton(entry.name, "📁", depth);
    button.dataset.nodeId = nodeId;
    button.dataset.path = currentPath;
    button.dataset.kind = "directory";
    button.dataset.loaded = "false";
    button.dataset.expanded = "false";
    const children = document.createElement("div");
    children.className = "children";
    children.hidden = true;

    button.addEventListener("click", async () => {
      const isExpanded = button.dataset.expanded === "true";
      if (isExpanded) {
        children.hidden = true;
        button.dataset.expanded = "false";
        button.querySelector(".icon").textContent = "📁";
        return;
      }
      button.dataset.expanded = "true";
      children.hidden = false;
      button.querySelector(".icon").textContent = "📂";
      if (button.dataset.loaded === "true") return;
      button.dataset.loaded = "true";
      setStatus(t("status.readingFolder", { path: currentPath }), true);
      const childEntries = await readDirectoryEntries(entry.handle);
      childEntries.forEach((child) => renderTreeNode(children, child, depth + 1, `${currentPath}/`));
      setStatus(t("status.readyPath", { path: currentPath }));
    });
    wrapper.append(button, children);
    parentEl.appendChild(wrapper);
  } else {
    const button = createNodeButton(entry.name, "📄", depth);
    button.dataset.nodeId = nodeId;
    button.dataset.path = currentPath;
    button.dataset.kind = "file";
    button.addEventListener("click", () => openFile(entry.handle, currentPath, button));
    parentEl.appendChild(button);
  }
}

async function renderTree() {
  treeEl.innerHTML = "";
  if (!rootHandle) return;
  setStatus(t("status.scanning"), true);
  const entries = await readDirectoryEntries(rootHandle);
  entries.forEach((entry) => renderTreeNode(treeEl, entry, 0, ""));
  setStatus(t("status.ready"));
}

function setActiveTree(path) {
  if (activeTreeNode) activeTreeNode.classList.remove("active");
  const next = treeEl.querySelector(`.node[data-path="${CSS.escape(path)}"]`);
  if (next) next.classList.add("active");
  activeTreeNode = next;
}

function updateTabDragIndicators() {
  if (!tabsEl) return;
  tabsEl.querySelectorAll(".tab").forEach((tabEl) => {
    const path = tabEl.dataset.path;
    tabEl.classList.toggle("dragging", path === draggedTabPath);
    tabEl.classList.toggle("drag-before", path === dragTargetTabPath && dragTargetPosition === "before");
    tabEl.classList.toggle("drag-after", path === dragTargetTabPath && dragTargetPosition === "after");
  });
}

function setTabDropTarget(path, position) {
  if (dragTargetTabPath === path && dragTargetPosition === position) return;
  dragTargetTabPath = path;
  dragTargetPosition = position;
  updateTabDragIndicators();
}

function clearTabDragState() {
  draggedTabPath = null;
  dragTargetTabPath = null;
  dragTargetPosition = null;
  updateTabDragIndicators();
}

function getTabDropPosition(event, tabEl) {
  const rect = tabEl.getBoundingClientRect();
  return event.clientX < rect.left + rect.width / 2 ? "before" : "after";
}

function moveTab(draggedPath, targetPath, position) {
  if (!draggedPath || !targetPath || draggedPath === targetPath) return false;
  const fromIndex = openOrder.indexOf(draggedPath);
  const targetIndex = openOrder.indexOf(targetPath);
  if (fromIndex < 0 || targetIndex < 0) return false;

  openOrder.splice(fromIndex, 1);
  const insertionIndex =
    targetIndex + (position === "after" ? 1 : 0) - (fromIndex < targetIndex ? 1 : 0);
  openOrder.splice(insertionIndex, 0, draggedPath);
  return true;
}

function renderTabs() {
  tabsEl.innerHTML = "";
  if (closeAllTabsBtn) {
    if (openOrder.length >= 2) {
      closeAllTabsBtn.removeAttribute("hidden");
      closeAllTabsBtn.textContent = t("tab.closeAll");
      closeAllTabsBtn.setAttribute("aria-label", t("aria.closeAllTabs"));
    } else closeAllTabsBtn.setAttribute("hidden", "");
  }
  const fragment = document.createDocumentFragment();
  openOrder.forEach((path) => {
    const file = openFiles.get(path);
    if (!file) return;
    const tab = document.createElement("button");
    tab.className = "tab";
    tab.dataset.path = path;
    tab.draggable = openOrder.length >= 2;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", path === activePath ? "true" : "false");
    tab.textContent = file.name;
    tab.addEventListener("click", () => setActiveFile(path));
    tab.addEventListener("dragstart", (event) => {
      if (openOrder.length < 2) {
        event.preventDefault();
        return;
      }
      draggedTabPath = path;
      dragTargetTabPath = null;
      dragTargetPosition = null;
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", path);
      }
      updateTabDragIndicators();
    });
    tab.addEventListener("dragover", (event) => {
      if (!draggedTabPath) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      setTabDropTarget(path, getTabDropPosition(event, tab));
    });
    tab.addEventListener("drop", (event) => {
      if (!draggedTabPath) return;
      event.preventDefault();
      event.stopPropagation();
      const position = getTabDropPosition(event, tab);
      const changed = moveTab(draggedTabPath, path, position);
      clearTabDragState();
      if (changed) renderTabs();
    });
    tab.addEventListener("dragend", () => {
      clearTabDragState();
    });
    const close = document.createElement("button");
    close.className = "close-tab";
    close.draggable = false;
    close.setAttribute("aria-label", t("tab.closeLabel", { name: file.name }));
    close.textContent = "×";
    close.addEventListener("click", (event) => { event.stopPropagation(); closeFile(path); });
    tab.appendChild(close);
    if (path === activePath) tab.classList.add("active");
    fragment.appendChild(tab);
  });
  tabsEl.appendChild(fragment);
  updateTabDragIndicators();
}

function closeFile(path) {
  openFiles.delete(path);
  scrollPositions.delete(path);
  const index = openOrder.indexOf(path);
  if (index >= 0) openOrder.splice(index, 1);
  if (activePath === path) activePath = openOrder[0] ?? null;
  renderTabs();
  renderPreview();
}

function closeAllFiles() {
  openFiles.clear();
  openOrder.length = 0;
  scrollPositions.clear();
  activePath = null;
  activeTreeNode = null;
  renderPreviewToken += 1;
  renderTabs();
  renderPreview();
  setStatus(t("status.ready"));
}

function setActiveFile(path) {
  if (activePath) scrollPositions.set(activePath, viewerEl.scrollTop);
  activePath = path;
  renderTabs();
  setActiveTree(path);
  renderPreview();
}

async function openFile(fileHandle, path, sourceButton) {
  if (openFiles.has(path)) { setActiveFile(path); return; }
  setStatus(t("status.readingFile", { path }), true);
  const file = await fileHandle.getFile();
  const content = await file.text();
  openFiles.set(path, { name: file.name, handle: fileHandle, content, renderedHtml: null });
  documentIndex.set(path, buildDocumentRecord({ path, content }));
  openOrder.push(path);
  if (sourceButton) sourceButton.classList.add("active");
  setActiveFile(path);
  setStatus(t("status.opened", { path }));
  if (rootHandle) {
    await saveHistory(rootHandle.name, rootHandle, [{ name: file.name, path }]);
  }
}

async function findFileHandle(path) {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return null;
  let dirHandle = rootHandle;
  try {
    for (let i = 0; i < parts.length - 1; i++) dirHandle = await dirHandle.getDirectoryHandle(parts[i]);
    return await dirHandle.getFileHandle(parts[parts.length - 1]);
  } catch { return null; }
}

async function navigateToInternalLink(href) {
  if (!rootHandle) return;
  const { path, hash } = splitDocumentLink(href);
  const resolvedPath = resolveWorkspacePath(activePath ?? "", path);
  const fileHandle = await findFileHandle(resolvedPath);
  if (fileHandle) {
    pendingAnchor = hash;
    await openFile(fileHandle, resolvedPath, null);
  } else {
    showToast(t("alert.fileNotFound", { path: resolvedPath }));
  }
}

async function renderPreview() {
  const currentPath = activePath;
  const token = ++renderPreviewToken;

  if (!activePath) { setPreviewVisible(false); return; }
  previewAssets.clear();
  const file = openFiles.get(activePath);
  if (!file) { setPreviewVisible(false); return; }
  if (!file.renderedHtml) {
    file.renderedHtml = marked.parse(file.content);
  }
  previewEl.innerHTML = file.renderedHtml;
  assignRenderedHeadingIds(documentIndex.get(activePath));

  const previewPath = activePath;
  previewEl.querySelectorAll("img").forEach((image) => {
    const src = image.getAttribute("src") || "";
    if (!isWorkspaceRelativeHref(src)) {
      return;
    }

    void resolveAssetUrl({
      href: src,
      activePath: previewPath,
      rootHandle,
      registry: previewAssets,
    })
      .then(({ url }) => {
        if (activePath !== previewPath) {
          return;
        }
        image.src = url;
      })
      .catch(() => {
        if (activePath !== previewPath) {
          return;
        }
        const fallback = document.createElement("div");
        fallback.className = "preview-image-missing";
        fallback.textContent = t("alert.assetNotFound", { path: src });
        image.replaceWith(fallback);
      });
  });

  if (containsMathSyntax(file.content)) {
    try {
      await renderMath(previewEl);
      if (token !== renderPreviewToken || activePath !== currentPath) {
        return;
      }
    } catch (err) {
      console.warn("[preview] Failed to render math:", err);
    }
  }

  const codeBlocks = previewEl.querySelectorAll("pre code");
  codeBlocks.forEach((block) => {
    const language = block.className.match(/language-([\w-]+)/)?.[1];
    if (language && language.toLowerCase() === "mermaid") {
      const container = document.createElement("div");
      container.className = "mermaid";
      container.textContent = block.textContent;
      const pre = block.closest("pre");
      if (pre) pre.replaceWith(container);
    }
  });

  generateTOC();
  setPreviewVisible(true);
  if (!applyPendingAnchor()) {
    viewerEl.scrollTop = scrollPositions.get(currentPath) ?? 0;
  }

  const highlightTargets = previewEl.querySelectorAll("pre code");
  if (highlightTargets.length > 0) {
    try {
      const prism = await ensurePrismLoaded();
      if (token === renderPreviewToken && activePath === currentPath && prism) {
        const doHighlight = () => prism.highlightAllUnder(previewEl);
        if ("requestIdleCallback" in window) requestIdleCallback(doHighlight);
        else setTimeout(doHighlight, 0);
      }
    } catch (err) {
      console.warn("[preview] Failed to load Prism:", err);
    }
  }

  const mermaidNodes = previewEl.querySelectorAll(".mermaid");
  if (mermaidNodes.length > 0) {
    try {
      const mermaid = await ensureMermaidLoaded();
      if (token === renderPreviewToken && activePath === currentPath && mermaid) {
        initMermaid();
        await mermaid.run({ nodes: mermaidNodes });
      }
    } catch (err) {
      console.warn("[preview] Failed to render Mermaid:", err);
      mermaidNodes.forEach((node) => {
        const pre = document.createElement("pre");
        pre.textContent = node.textContent;
        node.innerHTML = "";
        node.appendChild(pre);
      });
    }
  }
}

previewEl.addEventListener("click", async (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const link = target?.closest("a");
  if (!link) {
    return;
  }

  const href = link.getAttribute("href") || "";
  if (!href) {
    return;
  }

  if (href.startsWith("#")) {
    event.preventDefault();
    pendingAnchor = href.slice(1);
    applyPendingAnchor();
    return;
  }

  if (!isWorkspaceRelativeHref(href)) {
    return;
  }

  event.preventDefault();
  const { path } = splitDocumentLink(href);

  if (path.toLowerCase().endsWith(".md")) {
    await navigateToInternalLink(href);
    return;
  }

  let popup = null;
  try {
    popup = window.open("about:blank", "_blank");
    if (popup) {
      popup.opener = null;
    }
    const asset = await resolveAssetUrl({
      href: path,
      activePath,
      rootHandle,
      registry: previewAssets,
    });
    if (popup) {
      popup.location.replace(asset.url);
      popup.focus();
    } else {
      window.open(asset.url, "_blank", "noopener");
    }
  } catch {
    if (popup && !popup.closed) {
      popup.close();
    }
    const message = t("alert.assetNotFound", { path: href }) || href;
    if (typeof globalThis.showToast === "function") {
      globalThis.showToast(message);
    } else {
      alert(message);
    }
  }
});

openFolderButton.addEventListener("click", async () => {
  if (!window.showDirectoryPicker) { setStatus(t("status.unsupported")); showToast(t("status.unsupported")); return; }
  try {
    rootHandle = await window.showDirectoryPicker();
    openFiles.clear();
    openOrder.length = 0;
    activePath = null;
    cachedHeadings = [];
    tocRAFPending = false;
    activeTreeNode = null;
    pendingAnchor = "";
    searchQuery = "";
    currentSearchResults = { files: [], headings: [], content: [] };
    documentIndex.clear();
    indexBuildToken += 1;
    previewAssets.clear();
    if (workspaceSearchInput) {
      workspaceSearchInput.value = "";
    }
    hideSearchResults();
    setPreviewVisible(false);
    await renderTree();
    await saveHistory(rootHandle.name, rootHandle);
    void buildWorkspaceIndex();
  } catch (error) {
    setStatus(t("status.cancelled"));
  }
});

fontBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const key = normalizeProseFont(btn.dataset.font);
    currentProseFont = key;
    localStorage.setItem(proseFontStorageKey, key);
    applyProseFont(key);
  });
});

fontSizeBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const size = normalizeFontSize(btn.dataset.fontSize);
    currentFontSize = size;
    localStorage.setItem(fontSizeStorageKey, size);
    applyFontSize(size);
  });
});

if (themeToggle) {
  themeToggle.addEventListener("click", () => {
    const nextTheme = rootEl.getAttribute("data-theme") === "dark" ? "light" : "dark";
    localStorage.setItem(themeStorageKey, nextTheme);
    if (activePath) scrollPositions.set(activePath, viewerEl.scrollTop);
    applyTheme(nextTheme);
    if (previewEl.querySelector(".mermaid, mjx-container")) {
      void renderPreview();
    }
  });
}

let savedSidebarWidth = parseInt(localStorage.getItem(sidebarWidthStorageKey), 10) || 320;
function setSidebarCollapsed(collapsed) {
  appEl.classList.toggle("sidebar-collapsed", collapsed);
  if (collapsed) {
    const current = parseInt(appEl.style.getPropertyValue("--sidebar-width"), 10);
    if (current > 40) savedSidebarWidth = current;
    appEl.style.setProperty("--sidebar-width", "40px");
  } else appEl.style.setProperty("--sidebar-width", `${savedSidebarWidth}px`);
  if (sidebarToggle) {
    sidebarToggle.setAttribute("aria-pressed", collapsed ? "true" : "false");
    sidebarToggle.setAttribute("aria-label", collapsed ? t("aria.sidebarExpand") : t("aria.sidebarCollapse"));
    sidebarToggle.innerHTML = collapsed ? ICON_PANEL_OPEN : ICON_PANEL_CLOSE;
  }
}
if (sidebarToggle) sidebarToggle.addEventListener("click", () => setSidebarCollapsed(!appEl.classList.contains("sidebar-collapsed")));

if (resizerEl) {
  resizerEl.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const startX = e.clientX, startWidth = sidebarEl.getBoundingClientRect().width;
    resizerEl.classList.add("dragging");
    const onMouseMove = (me) => {
      const nw = Math.max(160, Math.min(600, startWidth + me.clientX - startX));
      appEl.style.setProperty("--sidebar-width", `${nw}px`);
    };
    const onMouseUp = () => {
      resizerEl.classList.remove("dragging");
      savedSidebarWidth = parseInt(appEl.style.getPropertyValue("--sidebar-width"), 10) || savedSidebarWidth;
      localStorage.setItem(sidebarWidthStorageKey, savedSidebarWidth);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });
}

if (langToggle) langToggle.addEventListener("click", () => setLang(currentLang === "zh-TW" ? "en" : "zh-TW"));
if (settingsToggle) {
  settingsToggle.addEventListener("click", () => {
    if (settingsDialog?.open) {
      closeSettingsDialog();
      return;
    }
    openSettingsDialog();
  });
}
if (settingsCloseButton) {
  settingsCloseButton.addEventListener("click", () => {
    closeSettingsDialog();
  });
}
if (settingsDialog) {
  settingsDialog.addEventListener("close", () => {
    if (settingsToggle) {
      settingsToggle.setAttribute("aria-pressed", "false");
      settingsToggle.focus();
    }
  });
  settingsDialog.addEventListener("click", (event) => {
    if (event.target === settingsDialog) {
      closeSettingsDialog();
    }
  });
}
if (mathRendererSelect) {
  mathRendererSelect.addEventListener("change", (event) => {
    const value = event.target instanceof HTMLSelectElement ? event.target.value : MATH_RENDERERS.katex;
    setMathRenderer(value);
  });
}
if (closeAllTabsBtn) closeAllTabsBtn.addEventListener("click", closeAllFiles);

if (recentPanelToggleBtn) {
  recentPanelToggleBtn.addEventListener("click", () => {
    const isExpanded = recentPanelToggleBtn.getAttribute("aria-expanded") === "true";
    const nextExpanded = !isExpanded;
    recentPanelToggleBtn.setAttribute("aria-expanded", String(nextExpanded));
    recentPanelBodyEl.hidden = !nextExpanded;
    const chevron = recentPanelToggleBtn.querySelector(".chevron-icon");
    if (chevron) chevron.classList.toggle("rotated", nextExpanded);
  });
}

if (workspaceEl) {
  workspaceEl.addEventListener("dragenter", (e) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes("Files")) {
      workspaceEl.classList.add("drag-over");
    }
  });

  workspaceEl.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes("Files")) {
      workspaceEl.classList.add("drag-over");
    }
  });

  workspaceEl.addEventListener("dragleave", (e) => {
    if (!workspaceEl.contains(e.relatedTarget)) {
      workspaceEl.classList.remove("drag-over");
    }
  });

  workspaceEl.addEventListener("drop", async (e) => {
    e.preventDefault();
    workspaceEl.classList.remove("drag-over");
    const item = e.dataTransfer.items[0];
    if (!item) return;
    const handle = await item.getAsFileSystemHandle();
    if (!handle || handle.kind !== "file") return;
    if (!handle.name.toLowerCase().endsWith(".md")) {
      showToast(t("alert.onlyMarkdown"));
      return;
    }
    await openFile(handle, handle.name, null);
  });
}

if (workspaceSearchInput) {
  workspaceSearchInput.addEventListener("input", (event) => {
    const nextQuery = event.target instanceof HTMLInputElement ? event.target.value : "";
    runSearch(nextQuery);
  });
}

if (tocToggleBtn && tocEl) {
  tocToggleBtn.addEventListener("click", () => {
    setTOCCollapsed(!tocEl.classList.contains("collapsed"));
  });
}

if (viewerEl) {
  viewerEl.addEventListener("scroll", updateTOCActive, { passive: true });
}

document.addEventListener("pointerdown", (event) => {
  if (!searchShellEl || !searchResultsEl || searchResultsEl.hidden) {
    return;
  }

  const target = event.target instanceof Node ? event.target : null;
  if (target && searchShellEl.contains(target)) {
    return;
  }

  hideSearchResults();
});

async function init() {
  await loadLocale(currentLang);
  applyLocale(currentLang);
  applyTheme(getPreferredTheme());
  applyProseFont(currentProseFont);
  applyFontSize(currentFontSize);
  initMermaid();
  appEl.style.setProperty("--sidebar-width", `${savedSidebarWidth}px`);
  setSidebarCollapsed(false);
  setPreviewVisible(false);
  await renderSidebarRecentPanel();
}
init();

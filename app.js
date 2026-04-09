import { marked } from "./libs/marked/marked.esm.js";

const openFolderButton = document.getElementById("open-folder");
const themeToggle = document.getElementById("theme-toggle");
const sidebarToggle = document.getElementById("sidebar-toggle");
const treeEl = document.getElementById("tree");
const tabsEl = document.getElementById("tabs");
const previewEl = document.getElementById("preview");
const tocEl = document.getElementById("toc");
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
const rootEl = document.documentElement;

const langToggle = document.getElementById("lang-toggle");

const langStorageKey = "markdown-explorer-lang";
const langTagMap = { "zh-TW": "zh-Hant-TW", en: "en" };
let currentLang = localStorage.getItem(langStorageKey) || "zh-TW";
let translations = {};

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

const ICON_TOC_CLOSE = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>`;
const ICON_TOC_OPEN = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>`;

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
const handleMap = new Map();
const openFiles = new Map();
const openOrder = [];
const scrollPositions = new Map();
let idSeed = 0;

marked.use({
  renderer: {
    html() { return ""; },
    link({ href, title, text }) {
      const safeTitle = title ? ` title="${title}"` : "";
      if (href && !/^(https?:\/\/|\/\/|mailto:|#)/.test(href)) {
        return `<a href="${href}" class="internal-link" data-href="${href}"${safeTitle}>${text}</a>`;
      }
      return `<a href="${href}" target="_blank" rel="noopener noreferrer"${safeTitle}>${text}</a>`;
    },
  },
});

const mermaidApi = window.mermaid;
const prismApi = window.Prism;
const themeStorageKey = "markdown-explorer-theme";

const ICON_SUN = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;
const ICON_MOON = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
const ICON_PANEL_CLOSE = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><line x1="9" x2="9" y1="3" y2="21"/><path d="m16 15-3-3 3-3"/></svg>`;
const ICON_PANEL_OPEN = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><line x1="9" x2="9" y1="3" y2="21"/><path d="m12 9 3 3-3 3"/></svg>`;

function getPreferredTheme() {
  const stored = localStorage.getItem(themeStorageKey);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
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

function initMermaid() {
  if (mermaidApi) {
    mermaidApi.initialize({ startOnLoad: false, theme: getMermaidTheme(), securityLevel: "strict" });
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
  toast.appendChild(msg);
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

function setPreviewVisible(isVisible) {
  viewerContainer.hidden = !isVisible;
  emptyEl.style.display = isVisible ? "none" : "flex";
}

function generateTOC() {
  if (!tocEl || !tocListContainer) return;
  const headings = Array.from(previewEl.querySelectorAll("h1, h2, h3, h4"));
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

if (tocToggleBtn) {
  tocToggleBtn.addEventListener("click", () => setTOCCollapsed(!tocEl.classList.contains("collapsed")));
}

function updateTOCActive() {
  if (!tocEl || tocEl.classList.contains("collapsed") || tocEl.style.display === "none") return;
  const headings = Array.from(previewEl.querySelectorAll("h1, h2, h3, h4"));
  const scrollPos = viewerEl.scrollTop + 64;
  let activeId = null;
  for (const heading of headings) {
    if (heading.offsetTop <= scrollPos) activeId = heading.id;
    else break;
  }
  tocEl.querySelectorAll(".toc-link").forEach((link) => {
    const isActive = link.getAttribute("href") === `#${activeId}`;
    link.classList.toggle("active", isActive);
    if (isActive) link.scrollIntoView({ behavior: "auto", block: "nearest" });
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

function createNodeButton(label, icon, depth = 0) {
  const button = document.createElement("button");
  button.className = "node";
  button.style.paddingLeft = `${8 + depth * 12}px`;
  button.innerHTML = `<span class="icon">${icon}</span><span>${label}</span>`;
  return button;
}

function renderTreeNode(parentEl, entry, depth, parentPath) {
  const nodeId = makeId();
  const currentPath = `${parentPath}${entry.name}`;
  handleMap.set(nodeId, entry.handle);

  if (entry.kind === "directory") {
    const wrapper = document.createElement("div");
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
  treeEl.querySelectorAll(".node").forEach((node) => {
    node.classList.toggle("active", node.dataset.path === path);
  });
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
  openOrder.forEach((path) => {
    const file = openFiles.get(path);
    if (!file) return;
    const tab = document.createElement("button");
    tab.className = "tab";
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", path === activePath ? "true" : "false");
    tab.textContent = file.name;
    tab.addEventListener("click", () => setActiveFile(path));
    const close = document.createElement("button");
    close.className = "close-tab";
    close.setAttribute("aria-label", t("tab.closeLabel", { name: file.name }));
    close.textContent = "×";
    close.addEventListener("click", (event) => { event.stopPropagation(); closeFile(path); });
    tab.appendChild(close);
    if (path === activePath) tab.classList.add("active");
    tabsEl.appendChild(tab);
  });
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
  openFiles.set(path, { name: file.name, handle: fileHandle, content });
  openOrder.push(path);
  if (sourceButton) sourceButton.classList.add("active");
  setActiveFile(path);
  setStatus(t("status.opened", { path }));
}

function resolvePath(path) {
  const parts = path.split("/");
  const result = [];
  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") result.pop();
    else if (part !== "") result.push(part);
  }
  return result.join("/");
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
  const pathPart = href.split("#")[0];
  if (!pathPart) return;
  const baseDir = activePath && activePath.includes("/") ? activePath.substring(0, activePath.lastIndexOf("/") + 1) : "";
  const relativePath = resolvePath(baseDir + pathPart);
  let fileHandle = await findFileHandle(relativePath);
  if (fileHandle) { await openFile(fileHandle, relativePath, null); return; }
  if (baseDir) {
    const rootPath = resolvePath(pathPart);
    if (rootPath !== relativePath) {
      fileHandle = await findFileHandle(rootPath);
      if (fileHandle) { await openFile(fileHandle, rootPath, null); return; }
    }
  }
  showToast(t("alert.fileNotFound", { path: relativePath }));
}

function renderPreview() {
  if (!activePath) { setPreviewVisible(false); return; }
  const file = openFiles.get(activePath);
  if (!file) { setPreviewVisible(false); return; }
  const html = marked.parse(file.content);
  previewEl.innerHTML = html;
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
  if (prismApi) prismApi.highlightAllUnder(previewEl);
  const mermaidNodes = previewEl.querySelectorAll(".mermaid");
  if (mermaidNodes.length > 0 && mermaidApi) {
    mermaidApi.run({ nodes: mermaidNodes }).catch(() => {
      mermaidNodes.forEach((node) => {
        const pre = document.createElement("pre");
        pre.textContent = node.textContent;
        node.innerHTML = "";
        node.appendChild(pre);
      });
    });
  }
  previewEl.querySelectorAll("a.internal-link").forEach((link) => {
    link.addEventListener("click", (e) => { e.preventDefault(); navigateToInternalLink(link.dataset.href); });
  });
  generateTOC();
  setPreviewVisible(true);
  viewerEl.scrollTop = scrollPositions.get(activePath) ?? 0;
}

if (viewerEl) viewerEl.addEventListener("scroll", updateTOCActive, { passive: true });

openFolderButton.addEventListener("click", async () => {
  if (!window.showDirectoryPicker) { setStatus(t("status.unsupported")); showToast(t("status.unsupported")); return; }
  try {
    rootHandle = await window.showDirectoryPicker();
    openFiles.clear(); openOrder.length = 0; activePath = null;
    setPreviewVisible(false); await renderTree();
  } catch { setStatus(t("status.cancelled")); }
});

if (themeToggle) {
  themeToggle.addEventListener("click", () => {
    const nextTheme = rootEl.getAttribute("data-theme") === "dark" ? "light" : "dark";
    localStorage.setItem(themeStorageKey, nextTheme);
    if (activePath) scrollPositions.set(activePath, viewerEl.scrollTop);
    applyTheme(nextTheme);
    initMermaid();
    renderPreview();
  });
}

let savedSidebarWidth = 320;
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
if (closeAllTabsBtn) closeAllTabsBtn.addEventListener("click", closeAllFiles);

async function init() {
  await loadLocale(currentLang);
  applyLocale(currentLang);
  applyTheme(getPreferredTheme());
  initMermaid();
  setSidebarCollapsed(false);
  setPreviewVisible(false);
}
init();

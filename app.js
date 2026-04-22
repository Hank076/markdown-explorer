import { marked } from "./libs/marked/marked.esm.js";
import { splitDocumentLink, resolveWorkspacePath } from "./app/workspace/path-utils.js";
import { createAssetUrlRegistry, isWorkspaceRelativeHref, resolveAssetUrl } from "./app/workspace/assets.js";
import { buildDocumentRecord, searchDocumentIndex } from "./app/workspace/document-index.js";

const openFolderButton = document.getElementById("open-folder");
const themeToggle = document.getElementById("theme-toggle");
const sidebarToggle = document.getElementById("sidebar-toggle");
const treeEl = document.getElementById("tree");
const tabsEl = document.getElementById("tabs");
const previewEl = document.getElementById("preview");
const emptyEl = document.getElementById("empty");
const statusText = document.getElementById("status-text");
const appEl = document.querySelector(".app");
const sidebarEl = document.querySelector(".sidebar");
const resizerEl = document.querySelector(".sidebar-resizer");
const viewerEl = document.querySelector(".viewer");
const rootEl = document.documentElement;

const langToggle = document.getElementById("lang-toggle");
const workspaceSearchInput = document.getElementById("workspace-search");
const workspaceSearchLabel = document.getElementById("workspace-search-label");
const searchResultsEl = document.getElementById("search-results");
const searchResultsLabel = document.getElementById("search-results-label");

const langStorageKey = "markdown-explorer-lang";
// BCP 47 tag map: locale key → precise html lang attribute value
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
    // If translations is still empty (first load, fetch failed), attempt zh-TW fallback
    if (Object.keys(translations).length === 0 && lang !== "zh-TW") {
      try {
        const fallback = await fetch("locales/zh-TW.json");
        if (fallback.ok) translations = await fallback.json();
      } catch {
        // Last resort: translations stays empty; t() returns raw keys
      }
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

  // Update theme toggle aria-label based on current theme
  const currentTheme = rootEl.getAttribute("data-theme");
  if (themeToggle && currentTheme) {
    themeToggle.setAttribute(
      "aria-label",
      currentTheme === "dark" ? t("aria.themeToLight") : t("aria.themeToDark")
    );
  }

  if (langToggle) {
    langToggle.textContent = t("lang.current");
    langToggle.setAttribute("aria-label", t("lang.switchLabel"));
    langToggle.setAttribute("aria-pressed", lang === "en" ? "true" : "false");
  }

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

  if (!rootHandle) {
    statusText.textContent = t("status.waiting");
  }

  renderSearchResults(currentSearchResults);
}

async function setLang(lang) {
  currentLang = lang;
  localStorage.setItem(langStorageKey, lang);
  await loadLocale(lang);
  applyLocale(lang);
  // Re-render icon and aria-pressed state on theme toggle; aria-label already set by applyLocale
  applyTheme(rootEl.getAttribute("data-theme") || getPreferredTheme());
  // Update sidebar toggle aria-label only — avoid calling setSidebarCollapsed() which resets --sidebar-width
  if (sidebarToggle) {
    const isCollapsed = appEl.classList.contains("sidebar-collapsed");
    sidebarToggle.setAttribute("aria-label", isCollapsed ? t("aria.sidebarExpand") : t("aria.sidebarCollapse"));
  }
  // Refresh already-open tab close-button aria-labels
  renderTabs();
}

let rootHandle = null;
let activePath = null;
let pendingAnchor = "";
const handleMap = new Map();
const openFiles = new Map();
const openOrder = [];
const scrollPositions = new Map();
const previewAssets = createAssetUrlRegistry();
let searchQuery = "";
let currentSearchResults = { files: [], headings: [], content: [] };
let indexBuildToken = 0;
const documentIndex = new Map();
let idSeed = 0;

marked.use({
  renderer: {
    html() {
      return "";
    },
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
  if (stored === "light" || stored === "dark") {
    return stored;
  }
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

function getMermaidTheme() {
  return rootEl.getAttribute("data-theme") === "dark" ? "dark" : "neutral";
}

function initMermaid() {
  if (mermaidApi) {
    mermaidApi.initialize({
      startOnLoad: false,
      theme: getMermaidTheme(),
      securityLevel: "strict",
    });
  }
}

function setStatus(text, loading = false) {
  statusText.textContent = text;
  statusText.classList.toggle("loading", loading);
}

function setPreviewVisible(isVisible) {
  previewEl.style.display = isVisible ? "block" : "none";
  emptyEl.style.display = isVisible ? "none" : "flex";
}

function makeId() {
  idSeed += 1;
  return `node-${idSeed}`;
}

async function readDirectoryEntries(dirHandle) {
  const entries = [];
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === "file" && !name.toLowerCase().endsWith(".md")) {
      continue;
    }
    entries.push({ name, handle, kind: handle.kind });
  }

  entries.sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === "directory" ? -1 : 1;
    }
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
      if (button.dataset.loaded === "true") {
        return;
      }
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
  if (!rootHandle) {
    return;
  }
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
  openOrder.forEach((path) => {
    const file = openFiles.get(path);
    if (!file) {
      return;
    }
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
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      closeFile(path);
    });

    tab.appendChild(close);
    if (path === activePath) {
      tab.classList.add("active");
    }
    tabsEl.appendChild(tab);
  });
}

function closeFile(path) {
  openFiles.delete(path);
  scrollPositions.delete(path);
  const index = openOrder.indexOf(path);
  if (index >= 0) {
    openOrder.splice(index, 1);
  }
  if (activePath === path) {
    activePath = openOrder[0] ?? null;
  }
  renderTabs();
  renderPreview();
}

function setActiveFile(path) {
  if (activePath) scrollPositions.set(activePath, viewerEl.scrollTop);
  activePath = path;
  renderTabs();
  setActiveTree(path);
  renderPreview();
}

async function openFile(fileHandle, path, sourceButton) {
  if (openFiles.has(path)) {
    setActiveFile(path);
    return;
  }
  setStatus(t("status.readingFile", { path }), true);
  const file = await fileHandle.getFile();
  const content = await file.text();
  openFiles.set(path, { name: file.name, handle: fileHandle, content, headings: [] });
  documentIndex.set(path, buildDocumentRecord({ path, content }));
  openOrder.push(path);
  if (sourceButton) {
    sourceButton.classList.add("active");
  }
  setActiveFile(path);
  setStatus(t("status.opened", { path }));
}

async function findFileHandle(path) {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return null;
  let dirHandle = rootHandle;
  try {
    for (let i = 0; i < parts.length - 1; i++) {
      dirHandle = await dirHandle.getDirectoryHandle(parts[i]);
    }
    return await dirHandle.getFileHandle(parts[parts.length - 1]);
  } catch {
    return null;
  }
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
    alert(t("alert.fileNotFound", { path: resolvedPath }));
  }
}

function renderPreview() {
  previewAssets.clear();
  if (!activePath) {
    setPreviewVisible(false);
    return;
  }
  const file = openFiles.get(activePath);
  if (!file) {
    setPreviewVisible(false);
    return;
  }

  const html = marked.parse(file.content);
  previewEl.innerHTML = html;
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

  const codeBlocks = previewEl.querySelectorAll("pre code");
  codeBlocks.forEach((block) => {
    const language = block.className.match(/language-([\w-]+)/)?.[1];
    if (language && language.toLowerCase() === "mermaid") {
      const container = document.createElement("div");
      container.className = "mermaid";
      container.textContent = block.textContent;
      const pre = block.closest("pre");
      if (pre) {
        pre.replaceWith(container);
      }
    }
  });

  if (prismApi) {
    prismApi.highlightAllUnder(previewEl);
  }

  const mermaidNodes = previewEl.querySelectorAll(".mermaid");
  if (mermaidNodes.length > 0 && mermaidApi) {
    mermaidApi
      .run({ nodes: mermaidNodes })
      .catch(() => {
        mermaidNodes.forEach((node) => {
          const pre = document.createElement("pre");
          pre.textContent = node.textContent;
          node.innerHTML = "";
          node.appendChild(pre);
        });
      });
  }
  if (mermaidNodes.length > 0 && !mermaidApi) {
    mermaidNodes.forEach((node) => {
      const pre = document.createElement("pre");
      pre.textContent = node.textContent;
      node.innerHTML = "";
      node.appendChild(pre);
    });
  }

  setPreviewVisible(true);
  if (!applyPendingAnchor()) {
    viewerEl.scrollTop = scrollPositions.get(activePath) ?? 0;
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
  if (!window.showDirectoryPicker) {
    setStatus(t("status.unsupported"));
    return;
  }
  try {
    rootHandle = await window.showDirectoryPicker();
    openFiles.clear();
    openOrder.length = 0;
    activePath = null;
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
    void buildWorkspaceIndex();
  } catch (error) {
    setStatus(t("status.cancelled"));
  }
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
  } else {
    appEl.style.setProperty("--sidebar-width", `${savedSidebarWidth}px`);
  }
  if (sidebarToggle) {
    sidebarToggle.setAttribute("aria-pressed", collapsed ? "true" : "false");
    sidebarToggle.setAttribute("aria-label", collapsed ? t("aria.sidebarExpand") : t("aria.sidebarCollapse"));
    sidebarToggle.innerHTML = collapsed ? ICON_PANEL_OPEN : ICON_PANEL_CLOSE;
  }
}

if (sidebarToggle) {
  sidebarToggle.addEventListener("click", () => {
    setSidebarCollapsed(!appEl.classList.contains("sidebar-collapsed"));
  });
}

if (resizerEl) {
  resizerEl.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarEl.getBoundingClientRect().width;
    resizerEl.classList.add("dragging");

    const onMouseMove = (moveEvent) => {
      const newWidth = Math.max(160, Math.min(600, startWidth + moveEvent.clientX - startX));
      appEl.style.setProperty("--sidebar-width", `${newWidth}px`);
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

if (langToggle) {
  langToggle.addEventListener("click", () => {
    const nextLang = currentLang === "zh-TW" ? "en" : "zh-TW";
    setLang(nextLang);
  });
}

if (workspaceSearchInput) {
  workspaceSearchInput.addEventListener("input", (event) => {
    const nextQuery = event.target instanceof HTMLInputElement ? event.target.value : "";
    runSearch(nextQuery);
  });
}

async function init() {
  await loadLocale(currentLang);
  applyLocale(currentLang);
  applyTheme(getPreferredTheme());
  initMermaid();
  setSidebarCollapsed(false);
  setPreviewVisible(false);
}

init();

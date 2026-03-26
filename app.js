import { marked } from "./libs/marked/marked.esm.js";

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

let rootHandle = null;
let activePath = null;
const handleMap = new Map();
const openFiles = new Map();
const openOrder = [];
const scrollPositions = new Map();
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
const rootEl = document.documentElement;
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
    themeToggle.setAttribute("aria-label", theme === "dark" ? "切換為亮色模式" : "切換為暗色模式");
    themeToggle.innerHTML = theme === "dark" ? ICON_SUN : ICON_MOON;
  }
}

applyTheme(getPreferredTheme());

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

initMermaid();

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
      setStatus(`讀取資料夾：${currentPath}`, true);
      const childEntries = await readDirectoryEntries(entry.handle);
      childEntries.forEach((child) => renderTreeNode(children, child, depth + 1, `${currentPath}/`));
      setStatus(`就緒：${currentPath}`);
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
  setStatus("掃描資料夾中...", true);
  const entries = await readDirectoryEntries(rootHandle);
  entries.forEach((entry) => renderTreeNode(treeEl, entry, 0, ""));
  setStatus("就緒");
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
    close.setAttribute("aria-label", `關閉 ${file.name}`);
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
  setStatus(`讀取檔案：${path}`, true);
  const file = await fileHandle.getFile();
  const content = await file.text();
  openFiles.set(path, { name: file.name, handle: fileHandle, content });
  openOrder.push(path);
  if (sourceButton) {
    sourceButton.classList.add("active");
  }
  setActiveFile(path);
  setStatus(`已開啟：${path}`);
}

function resolvePath(path) {
  const parts = path.split("/");
  const result = [];
  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") {
      result.pop();
    } else if (part !== "") {
      result.push(part);
    }
  }
  return result.join("/");
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
  const baseDir =
    activePath && activePath.includes("/")
      ? activePath.substring(0, activePath.lastIndexOf("/") + 1)
      : "";
  const resolvedPath = resolvePath(baseDir + href);
  const fileHandle = await findFileHandle(resolvedPath);
  if (fileHandle) {
    await openFile(fileHandle, resolvedPath, null);
  } else {
    alert(`找不到文件：${resolvedPath}`);
  }
}

function renderPreview() {
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

  previewEl.querySelectorAll("a.internal-link").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      navigateToInternalLink(link.dataset.href);
    });
  });

  setPreviewVisible(true);
  viewerEl.scrollTop = scrollPositions.get(activePath) ?? 0;
}

openFolderButton.addEventListener("click", async () => {
  if (!window.showDirectoryPicker) {
    setStatus("此瀏覽器不支援 File System Access API");
    return;
  }
  try {
    rootHandle = await window.showDirectoryPicker();
    openFiles.clear();
    openOrder.length = 0;
    activePath = null;
    setPreviewVisible(false);
    await renderTree();
  } catch (error) {
    setStatus("已取消選擇資料夾");
  }
});

if (themeToggle) {
  themeToggle.addEventListener("click", () => {
    const nextTheme = rootEl.getAttribute("data-theme") === "dark" ? "light" : "dark";
    localStorage.setItem(themeStorageKey, nextTheme);
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
    sidebarToggle.setAttribute("aria-label", collapsed ? "展開側邊欄" : "收合側邊欄");
    sidebarToggle.innerHTML = collapsed ? ICON_PANEL_OPEN : ICON_PANEL_CLOSE;
  }
}

setSidebarCollapsed(false);

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

setPreviewVisible(false);

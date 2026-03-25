import { marked } from "./libs/marked/marked.esm.js";

const openFolderButton = document.getElementById("open-folder");
const themeToggle = document.getElementById("theme-toggle");
const treeEl = document.getElementById("tree");
const tabsEl = document.getElementById("tabs");
const previewEl = document.getElementById("preview");
const emptyEl = document.getElementById("empty");
const statusText = document.getElementById("status-text");
const folderNameEl = document.getElementById("folder-name");

let rootHandle = null;
let activePath = null;
const handleMap = new Map();
const openFiles = new Map();
const openOrder = [];
let idSeed = 0;

marked.use({
  renderer: {
    html() {
      return "";
    },
    link(href, title, text) {
      const safeTitle = title ? ` title="${title}"` : "";
      return `<a href="${href}" target="_blank" rel="noopener noreferrer"${safeTitle}>${text}</a>`;
    },
  },
});

const mermaidApi = window.mermaid;
const prismApi = window.Prism;
const rootEl = document.documentElement;
const themeStorageKey = "markdown-explorer-theme";

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
    themeToggle.textContent = theme === "dark" ? "切換為亮色" : "切換為暗色";
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
        return;
      }
      button.dataset.expanded = "true";
      children.hidden = false;
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

function renderPreview() {
  if (!activePath) {
    setPreviewVisible(false);
    folderNameEl.textContent = rootHandle ? rootHandle.name : "尚未選擇資料夾";
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

  folderNameEl.textContent = rootHandle ? rootHandle.name : "尚未選擇資料夾";
  setPreviewVisible(true);
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

setPreviewVisible(false);

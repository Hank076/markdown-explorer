# Markdown Explorer

瀏覽器端的 Markdown 閱讀器。開啟本機資料夾、在側邊欄樹狀目錄瀏覽檔案，並以多分頁方式預覽 `.md` 檔案——不需要任何建置步驟或伺服器後端。

[English →](./README.md)

## 功能特色

- 資料夾樹狀側邊欄，支援拖曳調整寬度與收合切換
- 多分頁 Markdown 預覽，每個檔案的捲動位置獨立保留
- 語法高亮：[highlight.js](https://highlightjs.org/) 與 [Prism](https://prismjs.com/)
- [Mermaid](https://mermaid.js.org/) 圖表渲染（流程圖、序列圖、甘特圖等）
- 深色／亮色主題切換，偏好設定持久保存
- **UI 語言切換**——繁體中文 / English 一鍵切換，設定透過 localStorage 保存
- 無障礙設計：ARIA 標籤、`aria-pressed` 狀態、`:focus-visible` 支援
- 完全在瀏覽器端運作——無需建置步驟，無需伺服器

## 系統需求

- Chrome 或 Edge（需支援 [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API)）
- 本機 HTTP 伺服器（ES Module `import` 無法透過 `file://` 執行）

## 快速開始

```bash
# 複製專案
git clone https://github.com/your-username/markdown-explorer.git
cd markdown-explorer

# 啟動本機伺服器（擇一即可）
npm start
# 或
npx serve .
# 或
python -m http.server 8000
```

接著在 Chrome 或 Edge 開啟 `http://localhost:3000`（或終端機顯示的埠號）。

## 使用方式

1. 點擊**開啟資料夾**並授予檔案存取權限
2. 在側邊欄樹狀目錄中點選任意 `.md` 檔案，即可在新分頁開啟
3. 拖曳側邊欄邊緣可調整寬度，點擊切換按鈕可收合側邊欄
4. 點擊右上角太陽／月亮圖示切換主題
5. 點擊語言按鈕（中 / EN）切換介面語言

## 專案結構

```
markdown-explorer/
├── index.html        # 應用程式框架
├── app.js            # 所有應用邏輯
├── styles.css        # 樣式
├── locales/
│   ├── zh-TW.json    # 繁體中文字串
│   └── en.json       # 英文字串
├── libs/             # 已打包的相依套件（執行時不需 npm install）
└── docs/             # 設計文件
```

## 相依套件

所有相依套件均已打包於 `libs/`，**執行時不需 `npm install`**。

| 套件 | 版本 | 授權 |
|------|------|------|
| [marked](https://github.com/markedjs/marked) | ^17 | MIT |
| [highlight.js](https://github.com/highlightjs/highlight.js) | ^11 | BSD-3-Clause |
| [Prism](https://github.com/PrismLibrary/Prism) | ^1.30 | MIT |
| [Mermaid](https://github.com/mermaid-js/mermaid) | ^11 | MIT |

## 授權條款

[MIT](./LICENSE) © 2026 Hank

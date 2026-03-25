# Markdown Explorer

使用瀏覽器的 File System Access API 開啟本機資料夾，左側顯示樹狀目錄，右側可同時開啟多個 Markdown 檔案並預覽。

## 使用方式

1. 啟動本機靜態伺服器（避免 `file://` 的 ES Module 限制）
2. 用瀏覽器開啟 `index.html`
3. 點「開啟資料夾」並授權
4. 點選 `.md` 檔案在右側開啟

### 本機伺服器範例

```bash
# Python
python -m http.server 8000
```

## 瀏覽器支援

- Chrome / Edge（需支援 File System Access API）

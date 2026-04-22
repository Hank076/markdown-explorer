# 設計文件：Viewer-first 第一期

**日期**：2026-04-22  
**狀態**：已確認，待實作

## 需求摘要

本期採用 `Viewer-first` 路線，先補齊文件閱讀器的核心缺口，而不是往 editor-first 擴張。

第一期範圍包含三項核心能力，並允許加入必要的小型配套：

1. 相對圖片與附件支援
2. Workspace 搜尋能力
3. 跨檔案 anchor 導航與 heading ID 穩定化

本期不包含：

- 編輯器與 split view
- 匯出 HTML / PDF
- GFM alerts / LaTeX
- GitHub 線上匯入
- 複雜全文檢索或 fuzzy search

## 決策摘要

- **產品方向**：維持文件瀏覽器定位，不追求參考專案的 editor parity。
- **架構方案**：採用完整工作區模型，但功能範圍維持精簡。
- **索引策略**：第一期使用 in-memory index，不做 IndexedDB 持久化。
- **搜尋策略**：支援檔名、heading、全文三種命中類型，先以穩定可用為目標。
- **資源解析策略**：相對圖片與附件走統一路徑解析器，不直接在原始 Markdown 字串做全域 replace。
- **anchor 策略**：跨檔案 anchor 透過 pending anchor 狀態在 render 完成後精準定位。

## 架構設計

第一期建議維持純靜態前端與無 framework，但在現有 `app.js` 上建立明確責任層，避免後續功能持續堆疊在單一 render 流程內。

### 1. Workspace

負責整個已授權資料夾的事實來源與資源生命週期管理。

管理內容：

- `rootHandle`
- 檔案樹快取
- `path -> FileSystemHandle` 解析
- workspace 級別索引狀態
- asset object URLs 的建立與回收

主要責任：

- 掃描 Markdown 檔案
- 解析相對路徑
- 讀取圖片與附件 handle
- 管理索引建立進度

### 2. Document Index

負責將 Markdown 文件轉成可搜尋、可定位的 metadata。

每份文件至少包含：

- `path`
- `name`
- `rawContent`
- `plainText`
- `headings`
- `headingIdMap`
- `indexedAt` 或可比對的快取鍵
- `indexStatus`

這一層是後續搜尋、跨檔案 anchor、最近文件增強與 export 的共同基礎。

### 3. Preview Session

負責當前開啟文件的渲染狀態，不處理整個 workspace 的索引工作。

管理內容：

- `activePath`
- `openFiles`
- `openOrder`
- `scrollPositions`
- `renderPreviewToken`
- `pendingAnchor`
- 當前 preview 建立的 object URLs

主要責任：

- 根據 active file 產生 preview
- 追蹤切檔與重 render
- 在 render 後執行 anchor 定位
- 釋放不再需要的 object URLs

### 4. UI State

只放純 UI 狀態，不與文件內容耦合。

管理內容：

- sidebar 寬度與收合狀態
- TOC 收合狀態
- theme
- language
- 搜尋面板開關
- 搜尋 keyword
- indexing 進度顯示

## 資料流

### 開啟資料夾

1. `Workspace` 建立 root context 與 path resolver
2. 檔案樹優先可用
3. `Document Index` 背景建立索引
4. UI 顯示 indexing 狀態，但不阻塞閱讀

### 開啟文件

1. `Preview Session` 取得文件內容
2. render 前先解析相對圖片與附件
3. render 完成後套用 TOC、Prism、Mermaid
4. 若存在 `pendingAnchor`，則在此階段定位目標 heading

### 搜尋

1. 由 `Document Index` 提供檔名、heading、內文命中結果
2. UI 將結果分組顯示
3. 點擊結果後交由 `Preview Session` 開檔與定位

### 點擊相對連結

1. 先經過統一路徑解析器
2. 若為 `file.md#section`，先開檔，再定位 heading
3. 若為附件，於點擊時解析並建立 object URL

## 核心功能設計

### 1. 相對圖片 / 附件支援

目標是讓 workspace 內的常見本機相對路徑可正確預覽與開啟。

支援範圍：

- `![](./images/a.png)`
- `![](../assets/b.jpg)`
- `[下載 PDF](./files/spec.pdf)`
- `[跳到段落](#intro)`
- `[看安裝](./guide.md#install)`

第一期規則：

- 只解析 workspace 內相對路徑
- 不改寫 `http:`, `https:`, `mailto:`, `//`
- 不支援 `file://`
- 路徑超出 root 或解析失敗時，僅回報局部錯誤

圖片行為：

- render 階段解析相對路徑
- 讀取對應檔案並建立 object URL
- 指派至 `img.src`
- 圖片失敗時顯示 fallback，保留 alt 文案

附件行為：

- 點擊時才解析，不預先讀取全部附件
- 成功則開啟或下載對應 object URL
- 失敗則顯示 toast

資源生命週期：

- 每個 active preview session 維護自己的 object URL 清單
- 切檔、重 render、關閉分頁時統一 `URL.revokeObjectURL()`

### 2. 搜尋能力

第一期搜尋是 workspace 搜尋，不限制於已開分頁。

搜尋類型：

- 檔名搜尋
- heading 搜尋
- 全文搜尋

互動模型：

- 新增搜尋輸入框與結果面板
- 使用者輸入後即時顯示結果
- 結果分組為 `Files`、`Headings`、`Content`

點擊結果行為：

- file 命中：開檔
- heading 命中：開檔並定位 heading
- content 命中：開檔並捲到第一個相關命中區段

第一期不做：

- regex 搜尋
- 大小寫切換
- fuzzy search
- 全文所有命中高亮
- 搜尋結果持久化

排序原則：

1. 檔名完全或前綴命中優先
2. heading 命中次之
3. 內容命中最後
4. 路徑較短可微幅加分

### 3. 跨檔案 anchor 與 heading ID 穩定化

本期要同時解決兩個問題：

- `guide.md#install` 能正確開檔並定位
- 重複標題不再撞 ID

heading ID 規則：

- 使用 `slugify(text)` 作為基底
- 若 slug 重複，附加遞增序號
- 例如：
  - `install`
  - `install-2`
  - `install-3`

文件索引時預先建立：

- `headings[]`
- `slug -> heading id` 對照
- heading 順序資訊

跨檔案 anchor 行為：

1. 解析 `path` 與 `hash`
2. 開檔
3. render 完成後檢查目標 heading
4. 成功則 smooth scroll
5. 失敗則保留開檔結果，並提示「找不到對應段落」

同檔 anchor 行為：

- 不重新開檔
- 直接定位
- 同步更新 TOC active state

## 統一解析 API

第一期建議抽出下列 helper，避免路徑、資源與 anchor 規則散落在多處：

- `resolveWorkspacePath(basePath, targetPath)`
- `resolveAssetHandle(path)`
- `resolveAssetUrl(path)`
- `resolveDocumentAnchor(href)`
- `openDocumentAtAnchor(path, anchor)`

## 錯誤處理

原則是局部失敗不拖垮整體閱讀。

錯誤分級：

- 可恢復
  - 圖片找不到
  - 附件無法開啟
  - anchor 找不到對應 heading
  - 單一文件索引失敗
- 需中止目前操作
  - 資料夾權限失效
  - 目標檔案不存在且無法重新解析
  - render 前讀檔失敗

建議統一錯誤 code：

- `FILE_NOT_FOUND`
- `PERMISSION_DENIED`
- `ASSET_RESOLVE_FAILED`
- `ANCHOR_NOT_FOUND`
- `INDEX_FAILED`

對應行為：

- 圖片失敗：顯示 fallback，不中斷整篇 render
- 附件失敗：toast 提示，不改變 active file
- anchor 失敗：檔案照常開啟，只提示缺少段落
- 單檔索引失敗：記錄 warning，搜尋略過該檔
- 權限失效：停止索引，UI 回到待重新授權狀態

## 效能策略

第一期目標是避免明顯卡頓，不追求大型全文檢索引擎。

策略如下：

- 檔案樹與索引分離，先能瀏覽再背景建立索引
- 索引分批執行，每批處理後讓出事件循環
- 圖片在 render 階段解析，附件在點擊時解析
- 搜尋一律讀取索引，不掃 DOM
- 嚴格回收 object URLs，避免記憶體持續累積

第一期可接受的取捨：

- index 僅存在記憶體
- 搜尋採 substring match
- 不導入 Web Worker

## UI 與小型配套

允許加入必要但有限的小型配套，不擴大成新功能線。

包含：

- 搜尋輸入框
- 搜尋結果面板
- indexing 狀態顯示
- 圖片失敗 fallback 樣式
- 統一 toast / 錯誤文案

不包含：

- 搜尋進階篩選器
- 批次操作面板
- 全新資訊架構或大幅版面改造

## 測試策略

第一期測試分成三層。

### 單元邏輯

- `resolveWorkspacePath()`
- `slugify + dedupe heading ids`
- `href -> { path, hash }` 解析
- 搜尋排序與分組規則

### 整合流程

- 開啟檔案後正確 render 相對圖片
- 點擊 `guide.md#install` 後正確開檔並定位
- 搜尋結果點擊後導向正確檔案或段落
- 切檔後 object URL 被回收

### 手動驗證清單

- `./image.png`
- `../assets/spec.pdf`
- `./guide.md#install`
- 同文件內多個 `## Install`
- 大量 Markdown 檔案下搜尋仍可用
- 找不到檔案與權限失效時提示正確

## 實作邊界

本期完成後，產品能力應明確升級成：

- 可閱讀帶相對圖片與附件的 docs
- 可在整個 workspace 中搜尋
- 可可靠處理跨檔案段落跳轉

本期不應順手擴充 editor、export、GFM alerts 或 LaTeX，以維持 Viewer-first 的範圍控制。

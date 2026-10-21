# ML-Scratch

版本：v2.1.0

用 **節點拉線** 組合資料流、用 **Scratch 積木** 寫邏輯，讓初學者不寫程式也能體驗機器學習的完整流程：收集資料 → 標註 → 遷移學習訓練 → 即時推論 → 用結果驅動程式。

| 功能 | 內容 |
| --- | --- |
| YOLO 物件偵測 | 預訓練 YOLO11（COCO 80 類）直接使用，或用自己標註的框微調 |
| 圖片分類 | YOLO11n-cls（ImageNet 預訓練）微調，攝影機按住連拍收集資料 |
| 文字分類／情緒分析 | 凍結的多語言 MiniLM 句向量 ＋ 可訓練線性層，支援中文 |
| 本機 LLM 對話 | llama.cpp 執行 Qwen2.5 0.5B／1.5B（GGUF），首次使用時下載，之後可離線 |
| 訓練視覺化 | 即時 loss、準確度／mAP 曲線與訓練紀錄 |
| 內建標註工具 | 圖片分類拍照、物件偵測拖曳畫框、文字貼標籤、資料夾與 CSV 匯入 |

## 一鍵啟動（Windows）

1. 安裝 [Node.js LTS](https://nodejs.org/) 與 [Python 3.12](https://www.python.org/downloads/)（安裝時勾選 *Add python.exe to PATH*）。
2. 雙擊 `start.bat`。

第一次執行會自動建立虛擬環境並安裝 PyTorch、Ultralytics 等套件（約 5–15 分鐘）；偵測到 NVIDIA 顯示卡時自動安裝 CUDA 版本，否則使用 CPU。之後啟動只需數秒。

## 使用方式

上半部是 **資料流畫布**：從左側拖曳節點，從輸出圓點（右）拉線到輸入圓點（左）。型別不符的連線會被拒絕。

| 節點 | 輸入 | 輸出 | 用途 |
| --- | --- | --- | --- |
| 資料集 | — | 資料集 | 指定名稱與任務，按「開啟標註」收集資料 |
| 預訓練模型 | — | 模型 | 選擇預訓練權重 |
| 訓練 | 資料集、模型 | 模型 | 遷移學習，曲線顯示在「訓練」分頁 |
| 攝影機 | — | 圖片 | 即時畫面 |
| 文字輸入 | — | 文字 | 來自「預覽」分頁下方的輸入框 |
| 推論 | 模型、來源 | — | 對圖片或文字推論，結果送進積木事件 |
| LLM 對話 | 文字（可不接） | — | 本機 LLM，可接文字輸入直接對話，或由積木呼叫 |

下半部是 **積木區**：「當 推論1 有新結果」「偵測到 person 的數量」「問 LLM …」「唸出 …」等積木，搭配一般的如果／重複／變數。只有掛在事件積木底下的積木會執行。

按 **開始** 執行，**停止** 結束。專案（節點＋積木）可存成 `.mlsb` 檔；程式也會自動暫存上次的內容。

開啟時的範例專案：攝影機 → YOLO11n 偵測 → 看到人就顯示「看到人了！」。

## 架構

```
electron/   Electron 主程序：啟動 Python 後端（隨機埠＋隨機權杖，只聽 127.0.0.1）、以 app:// 提供前端
src/        前端（Vite）：Drawflow 節點編輯器、Blockly 積木、Chart.js 曲線、標註工具
  tokens/   由 design/tokens.json 自動產生的 tokens.css 與 tokens.js（勿手改）
  icon-paths.js  由 scripts/build-icons.mjs 從 Lucide 圖示資料產生（勿手改；新增圖示請改該腳本的 ICONS 清單）
design/     設計權杖唯一來源 tokens.json（primitive → semantic → component 三層）
  i18n/     語系檔（目前 zh-TW；新增語言時複製 zh-TW.js 翻譯即可）
backend/    FastAPI 後端：資料集、訓練工作（WebSocket 推送進度）、推論、LLM
```

資料（資料集、模型、權重、LLM）存在 `%APPDATA%\ml-scratch\workspace`。

## 設計權杖

所有顏色、間距、圓角、字級、動態時間都定義在 `design/tokens.json`，分三層：

| 層級 | 例子 | 何時修改 |
| --- | --- | --- |
| primitive | `color.blue.600`、`space.2`、`radius.lg` | 幾乎不改，是原始數值 |
| semantic | `color.primary`、`color.node.train`、`color.block.events`、`color.category.1–9` | 換主題或調整用途時 |
| component | `button.pressScale`、`node.titleRadius`、`port.hitSize` | 只調整單一元件時 |

`npm run tokens`（`npm run build` 也會自動執行）產生：

- `src/tokens/tokens.css`：CSS 變數，保留層級引用（例：`--color-primary: var(--color-blue-600)`）
- `src/tokens/tokens.js`：已解析的實際值，給無法讀 CSS 變數的 Blockly、Chart.js 與 Canvas 使用

元件樣式與 JS 一律引用權杖，不寫死色碼或尺寸。

## 開發

```bash
npm install
python -m venv .venv && .venv/Scripts/pip install torch torchvision -r backend/requirements-dev.txt
npm start                      # 建置前端並啟動 Electron

cd backend
python -m pytest               # 單元測試（不需網路）
ML_SCRATCH_SLOW=1 python -m pytest   # 另跑 YOLO 偵測／分類的實際訓練冒煙測試
```

## 授權

本專案採 **AGPL-3.0-or-later**（因使用 AGPL-3.0 授權的 Ultralytics YOLO）。散布修改版本時須同樣以 AGPL 開放原始碼。

第三方元件：Blockly（Apache-2.0）、Drawflow（MIT）、Chart.js（MIT）、Lucide 圖示（ISC，經 @iconify-json/lucide）、Qwen2.5-0.5B／1.5B-Instruct（Apache-2.0）、paraphrase-multilingual-MiniLM-L12-v2（Apache-2.0）。

## 版本紀錄

- **v2.1.0**：圖示改由 `@iconify-json/lucide` 產生（修正手抄的過時 play 圖示）；節點清單、節點標題與右側分頁加入對應圖示；開啟舊專案時以新版樣板重建節點外觀。
- **v2.0.0**：樣式系統重構為三層設計權杖（`design/tokens.json` → CSS 變數＋JS 常數）；CSS 與 JS 中寫死的 64 個色碼、62 個像素值全部改為權杖引用。外觀不變，唯一可見差異：標註框類別色改與訓練曲線共用同一組類別色序列。
- **v1.1.1**：介面細節打磨。按鈕改用陰影外框並加入按下縮放回饋；節點標題列同心圓角；連線圓點點擊範圍擴大至 34px、懸停改為光暈；刪除鈕點擊範圍擴大；變動數字改用等寬數字；提示訊息加入淡入／淡出；圖示線寬配合文字粗細；縮圖加細外框；字體平滑與標題換行平衡。
- **v1.1.0**：介面可近用性改善。節點、積木與按鈕配色的白字對比提升至 WCAG AA（≥ 4.5:1）；圖示改用 SVG（取代 emoji）；加入鍵盤焦點框、分頁方向鍵切換、節點清單可用鍵盤加入；刪除資料前需確認；連拍時即時顯示張數；訓練面板新增「停止訓練」；執行中停用節點按鈕；支援「減少動態效果」設定。
- **v1.0.0**：初版骨架。

## 已知限制

- 只提供 Windows 啟動檔；macOS／Linux 可依「開發」步驟手動執行。
- 文字分類的編碼器與 LLM 模型需從 Hugging Face 下載；無法連線時可設定環境變數 `HF_ENDPOINT` 指向鏡像站。
- 積木程式以 `new AsyncFunction` 執行，前端 CSP 因此開啟 `unsafe-eval`（僅限本機前端）。

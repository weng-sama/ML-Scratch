# ML-Scratch

版本：v1.0.0

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

按 **▶ 開始** 執行，**■ 停止** 結束。專案（節點＋積木）可存成 `.mlsb` 檔；程式也會自動暫存上次的內容。

開啟時的範例專案：攝影機 → YOLO11n 偵測 → 看到人就顯示「看到人了！」。

## 架構

```
electron/   Electron 主程序：啟動 Python 後端（隨機埠＋隨機權杖，只聽 127.0.0.1）、以 app:// 提供前端
src/        前端（Vite）：Drawflow 節點編輯器、Blockly 積木、Chart.js 曲線、標註工具
  i18n/     語系檔（目前 zh-TW；新增語言時複製 zh-TW.js 翻譯即可）
backend/    FastAPI 後端：資料集、訓練工作（WebSocket 推送進度）、推論、LLM
```

資料（資料集、模型、權重、LLM）存在 `%APPDATA%\ml-scratch\workspace`。

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

第三方元件：Blockly（Apache-2.0）、Drawflow（MIT）、Chart.js（MIT）、Qwen2.5-0.5B／1.5B-Instruct（Apache-2.0）、paraphrase-multilingual-MiniLM-L12-v2（Apache-2.0）。

## 已知限制（v1.0.0）

- 只提供 Windows 啟動檔；macOS／Linux 可依「開發」步驟手動執行。
- 文字分類的編碼器與 LLM 模型需從 Hugging Face 下載；無法連線時可設定環境變數 `HF_ENDPOINT` 指向鏡像站。
- 積木程式以 `new AsyncFunction` 執行，前端 CSP 因此開啟 `unsafe-eval`（僅限本機前端）。

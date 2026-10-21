"""執行期設定：資料目錄與存取權杖（由 Electron 主程序以環境變數傳入）。"""
import os
import re
import secrets
from pathlib import Path

HOME = Path(os.environ.get("ML_SCRATCH_HOME", Path.home() / ".ml-scratch")).resolve()
DATASETS_DIR = HOME / "datasets"
MODELS_DIR = HOME / "models"
RUNS_DIR = HOME / "runs"
LLM_DIR = HOME / "llm"

# 只允許本機 Electron 前端呼叫：每次啟動產生的隨機權杖
TOKEN = os.environ.get("ML_SCRATCH_TOKEN") or secrets.token_hex(16)

for d in (DATASETS_DIR, MODELS_DIR, RUNS_DIR, LLM_DIR):
    d.mkdir(parents=True, exist_ok=True)

# 資料集名稱與類別名稱會成為資料夾名稱，限制字元以防路徑穿越
_NAME_RE = re.compile(r"^[\w\-㐀-鿿 ]{1,40}$")


def check_name(name: str) -> str:
    name = (name or "").strip()
    if not _NAME_RE.match(name) or name in (".", ".."):
        raise ValueError(f"名稱不合法：{name!r}（限中英文、數字、空白、底線、連字號，最多 40 字）")
    return name

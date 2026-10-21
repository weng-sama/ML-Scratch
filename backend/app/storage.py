"""資料集與模型的檔案儲存。

目錄結構（HOME 底下）：
  datasets/<名稱>/meta.json
    image_cls : images/<類別>/<id>.jpg
    detect    : images/<id>.jpg、labels/<id>.txt（YOLO 格式，存在即代表已標註）
    text_cls  : samples.jsonl（每行 {"id","text","label"}）
  models/<id>/meta.json 與權重檔
"""
import base64
import csv
import io
import json
import shutil
import time
import uuid
from pathlib import Path

from PIL import Image

from .config import DATASETS_DIR, MODELS_DIR, check_name

TASKS = ("image_cls", "detect", "text_cls")
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def _read_json(p: Path, default=None):
    return json.loads(p.read_text("utf-8")) if p.exists() else default


def _write_json(p: Path, data):
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2), "utf-8")


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


def _check_id(item_id: str) -> str:
    if not item_id.isalnum():
        raise ValueError("id 不合法")
    return item_id


# ---------- 資料集 ----------

def dataset_dir(name: str) -> Path:
    d = DATASETS_DIR / check_name(name)
    if not (d / "meta.json").exists():
        raise FileNotFoundError(f"找不到資料集：{name}")
    return d


def list_datasets():
    out = []
    for d in sorted(DATASETS_DIR.iterdir()):
        meta = _read_json(d / "meta.json")
        if meta:
            out.append(meta)
    return out


def create_dataset(name: str, task: str):
    name = check_name(name)
    if task not in TASKS:
        raise ValueError(f"未知的任務類型：{task}")
    d = DATASETS_DIR / name
    if (d / "meta.json").exists():
        meta = _read_json(d / "meta.json")
        if meta["task"] != task:
            raise ValueError(f"資料集「{name}」已存在，且任務類型為 {meta['task']}")
        return meta
    d.mkdir(parents=True, exist_ok=True)
    meta = {"name": name, "task": task, "classes": [], "created": time.time()}
    _write_json(d / "meta.json", meta)
    return meta


def get_meta(name: str):
    return _read_json(dataset_dir(name) / "meta.json")


def set_classes(name: str, classes: list[str]):
    d = dataset_dir(name)
    meta = _read_json(d / "meta.json")
    classes = [check_name(c) for c in classes]
    if len(set(classes)) != len(classes):
        raise ValueError("類別名稱重複")
    if meta["task"] == "detect":
        # 偵測任務以索引記錄類別：只允許在尾端新增或改名，避免既有標註錯位
        old = meta["classes"]
        if len(classes) < len(old):
            raise ValueError("偵測資料集不可刪除類別（既有標註以索引對應類別）")
    elif meta["task"] == "image_cls":
        for c in classes:
            (d / "images" / c).mkdir(parents=True, exist_ok=True)
    meta["classes"] = classes
    _write_json(d / "meta.json", meta)
    return meta


def _ensure_class(d: Path, meta: dict, label: str):
    label = check_name(label)
    if label not in meta["classes"]:
        meta["classes"].append(label)
        _write_json(d / "meta.json", meta)
    return label


def _save_image(img: Image.Image, path: Path, max_side=1280):
    img = img.convert("RGB")
    img.thumbnail((max_side, max_side))
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "JPEG", quality=90)


def decode_image(b64: str) -> Image.Image:
    if "," in b64[:100]:
        b64 = b64.split(",", 1)[1]  # 去掉 data URL 前綴
    return Image.open(io.BytesIO(base64.b64decode(b64)))


def add_image(name: str, image_b64: str, label: str | None = None):
    d = dataset_dir(name)
    meta = _read_json(d / "meta.json")
    img = decode_image(image_b64)
    item_id = _new_id()
    if meta["task"] == "image_cls":
        if not label:
            raise ValueError("圖片分類需要指定類別")
        label = _ensure_class(d, meta, label)
        _save_image(img, d / "images" / label / f"{item_id}.jpg")
    elif meta["task"] == "detect":
        _save_image(img, d / "images" / f"{item_id}.jpg")
    else:
        raise ValueError("文字資料集不能加入圖片")
    return {"id": item_id, "label": label}


def import_folder(name: str, folder: str, label: str | None = None):
    """圖片分類：folder 底下的子資料夾即類別（或指定 label 匯入整個資料夾）；
    物件偵測：匯入 folder 內所有圖片（之後再標註）。"""
    d = dataset_dir(name)
    meta = _read_json(d / "meta.json")
    src = Path(folder)
    if not src.is_dir():
        raise ValueError(f"資料夾不存在：{folder}")
    count = 0

    def imgs(p: Path):
        return [f for f in sorted(p.iterdir()) if f.is_file() and f.suffix.lower() in IMAGE_EXTS]

    if meta["task"] == "image_cls":
        groups = [(label, src)] if label else [(sub.name, sub) for sub in sorted(src.iterdir()) if sub.is_dir()]
        for cls, sub in groups:
            files = imgs(sub)
            if not files:
                continue
            cls = _ensure_class(d, meta, cls)
            for f in files:
                _save_image(Image.open(f), d / "images" / cls / f"{_new_id()}.jpg")
                count += 1
    elif meta["task"] == "detect":
        for f in imgs(src):
            _save_image(Image.open(f), d / "images" / f"{_new_id()}.jpg")
            count += 1
    else:
        raise ValueError("文字資料集請匯入 CSV")
    return {"imported": count}


def list_items(name: str):
    d = dataset_dir(name)
    meta = _read_json(d / "meta.json")
    items = []
    if meta["task"] == "image_cls":
        for cls in meta["classes"]:
            for f in sorted((d / "images" / cls).glob("*.jpg")):
                items.append({"id": f.stem, "label": cls})
    elif meta["task"] == "detect":
        for f in sorted((d / "images").glob("*.jpg"), key=lambda p: p.stat().st_mtime):
            items.append({"id": f.stem, "labeled": (d / "labels" / f"{f.stem}.txt").exists()})
    else:
        items = _read_samples(d)
    return {"meta": meta, "items": items}


def image_path(name: str, item_id: str) -> Path:
    d = dataset_dir(name)
    item_id = _check_id(item_id)
    hits = list((d / "images").rglob(f"{item_id}.jpg"))
    if not hits:
        raise FileNotFoundError("找不到圖片")
    return hits[0]


def delete_item(name: str, item_id: str):
    d = dataset_dir(name)
    meta = _read_json(d / "meta.json")
    item_id = _check_id(item_id)
    if meta["task"] == "text_cls":
        samples = [s for s in _read_samples(d) if s["id"] != item_id]
        _write_samples(d, samples)
        return
    image_path(name, item_id).unlink()
    (d / "labels" / f"{item_id}.txt").unlink(missing_ok=True)


def get_boxes(name: str, item_id: str):
    d = dataset_dir(name)
    p = d / "labels" / f"{_check_id(item_id)}.txt"
    boxes = []
    if p.exists():
        for line in p.read_text().splitlines():
            parts = line.split()
            if len(parts) == 5:
                c, x, y, w, h = parts
                boxes.append({"cls": int(c), "x": float(x), "y": float(y), "w": float(w), "h": float(h)})
    return boxes


def set_boxes(name: str, item_id: str, boxes: list[dict]):
    """boxes 以 YOLO 格式（中心點 x,y 與寬高 w,h，皆為 0–1 的比例）儲存。"""
    d = dataset_dir(name)
    meta = _read_json(d / "meta.json")
    image_path(name, item_id)
    lines = []
    for b in boxes:
        c = int(b["cls"])
        if not 0 <= c < len(meta["classes"]):
            raise ValueError(f"類別索引超出範圍：{c}")
        vals = [min(max(float(b[k]), 0.0), 1.0) for k in ("x", "y", "w", "h")]
        if vals[2] <= 0 or vals[3] <= 0:
            continue
        lines.append(f"{c} " + " ".join(f"{v:.6f}" for v in vals))
    (d / "labels").mkdir(exist_ok=True)
    (d / "labels" / f"{item_id}.txt").write_text("\n".join(lines))


def _read_samples(d: Path):
    p = d / "samples.jsonl"
    if not p.exists():
        return []
    return [json.loads(line) for line in p.read_text("utf-8").splitlines() if line.strip()]


def _write_samples(d: Path, samples):
    (d / "samples.jsonl").write_text("".join(json.dumps(s, ensure_ascii=False) + "\n" for s in samples), "utf-8")


def add_text(name: str, text: str, label: str):
    d = dataset_dir(name)
    meta = _read_json(d / "meta.json")
    if meta["task"] != "text_cls":
        raise ValueError("只有文字資料集可以加入文字")
    text = text.strip()
    if not text:
        raise ValueError("文字不可為空")
    label = _ensure_class(d, meta, label)
    sample = {"id": _new_id(), "text": text, "label": label}
    with (d / "samples.jsonl").open("a", encoding="utf-8") as f:
        f.write(json.dumps(sample, ensure_ascii=False) + "\n")
    return sample


def import_csv(name: str, path: str):
    """CSV 需含 text 與 label 兩欄（有標題列）。"""
    raw = Path(path).read_bytes()
    for enc in ("utf-8-sig", "cp950"):  # Excel 在繁中 Windows 預設存成 cp950
        try:
            content = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    else:
        raise ValueError("無法辨識 CSV 編碼，請另存為 UTF-8")
    rows = list(csv.DictReader(io.StringIO(content)))
    if rows and not {"text", "label"} <= set(rows[0]):
        raise ValueError("CSV 需要 text 與 label 兩個欄位")
    n = 0
    for r in rows:
        if (r.get("text") or "").strip() and (r.get("label") or "").strip():
            add_text(name, r["text"], r["label"].strip())
            n += 1
    return {"imported": n}


# ---------- 模型 ----------

def new_model_dir() -> tuple[str, Path]:
    mid = time.strftime("%Y%m%d-%H%M%S-") + _new_id()[:4]
    d = MODELS_DIR / mid
    d.mkdir(parents=True)
    return mid, d


def save_model_meta(model_dir: Path, meta: dict):
    _write_json(model_dir / "meta.json", meta)


def get_model(model_id: str):
    if not all(c.isalnum() or c == "-" for c in model_id):
        raise ValueError("模型 id 不合法")
    meta = _read_json(MODELS_DIR / model_id / "meta.json")
    if not meta:
        raise FileNotFoundError(f"找不到模型：{model_id}")
    return meta, MODELS_DIR / model_id


def list_models():
    out = []
    for d in sorted(MODELS_DIR.iterdir(), reverse=True):
        meta = _read_json(d / "meta.json")
        if meta:
            out.append(meta)
    return out


def delete_model(model_id: str):
    _, d = get_model(model_id)
    shutil.rmtree(d)

"""推論：支援訓練好的模型（模型編號）與預訓練模型（"pretrained:<key>"）。"""
import threading
from collections import OrderedDict

from . import device, storage
from .trainers import PRETRAINED, weights_path

_cache: OrderedDict = OrderedDict()
_lock = threading.Lock()
_CACHE_SIZE = 4


def _load(model_ref: str):
    with _lock:
        if model_ref in _cache:
            _cache.move_to_end(model_ref)
            return _cache[model_ref]
        entry = _build(model_ref)
        _cache[model_ref] = entry
        while len(_cache) > _CACHE_SIZE:
            _cache.popitem(last=False)
        return entry


def _build(model_ref: str):
    if model_ref.startswith("pretrained:"):
        key = model_ref.split(":", 1)[1]
        if key not in PRETRAINED:
            raise ValueError(f"未知的預訓練模型：{key}")
        task, weights, _ = PRETRAINED[key]
        if task == "text_cls":
            raise ValueError("文字編碼器需要先接到「訓練」節點才能分類")
        from ultralytics import YOLO
        return {"task": task, "model": YOLO(weights_path(weights))}

    meta, d = storage.get_model(model_ref)
    if meta["task"] in ("image_cls", "detect"):
        from ultralytics import YOLO
        return {"task": meta["task"], "model": YOLO(str(d / "weights.pt"))}

    import torch
    from .trainers.text_cls import get_encoder
    head = torch.nn.Linear(meta["dim"], len(meta["classes"]))
    head.load_state_dict(torch.load(d / "head.pt", map_location="cpu"))
    head.eval()
    return {"task": "text_cls", "head": head, "encode": get_encoder(meta["base"]), "classes": meta["classes"]}


def predict_image(model_ref: str, image_b64: str, conf: float = 0.25):
    m = _load(model_ref)
    if m["task"] == "text_cls":
        raise ValueError("這是文字模型，請改接文字來源")
    img = storage.decode_image(image_b64).convert("RGB")
    res = m["model"].predict(img, conf=conf, device=device.info()["ultralytics"], verbose=False)[0]
    names = res.names
    if m["task"] == "image_cls":
        probs = res.probs
        top = [{"label": names[int(i)], "conf": round(float(probs.data[int(i)]), 4)} for i in probs.top5]
        return {"task": "image_cls", "label": top[0]["label"], "conf": top[0]["conf"], "top": top}
    boxes = []
    for b in res.boxes:
        x1, y1, x2, y2 = (float(v) for v in b.xyxyn[0])
        boxes.append({"label": names[int(b.cls)], "conf": round(float(b.conf), 4),
                      "x1": x1, "y1": y1, "x2": x2, "y2": y2})
    boxes.sort(key=lambda b: -b["conf"])
    best = boxes[0] if boxes else None
    return {"task": "detect", "boxes": boxes, "label": best["label"] if best else "",
            "conf": best["conf"] if best else 0.0}


def predict_text(model_ref: str, text: str):
    import torch

    m = _load(model_ref)
    if m["task"] != "text_cls":
        raise ValueError("這是圖片模型，請改接圖片來源")
    with torch.no_grad():
        probs = torch.softmax(m["head"](m["encode"]([text])), dim=1)[0]
    order = probs.argsort(descending=True).tolist()
    top = [{"label": m["classes"][i], "conf": round(float(probs[i]), 4)} for i in order[:5]]
    return {"task": "text_cls", "label": top[0]["label"], "conf": top[0]["conf"], "top": top, "text": text}


def forget(model_ref: str):
    with _lock:
        _cache.pop(model_ref, None)

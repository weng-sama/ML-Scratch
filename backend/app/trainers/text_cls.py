"""文字分類：凍結的多語言句向量編碼器 + 可訓練的線性分類層（遷移學習）。"""
import random
import threading
import time

from .. import device, storage
from ..jobs import Job
from . import PRETRAINED

_encoders = {}
_enc_lock = threading.Lock()


def get_encoder(name: str):
    """回傳 encode(list[str]) -> torch.Tensor[N, D] 的函式；模型第一次使用時自動下載。"""
    with _enc_lock:
        if name not in _encoders:
            from sentence_transformers import SentenceTransformer

            model = SentenceTransformer(name, device=device.info()["device"])
            _encoders[name] = lambda texts: model.encode(texts, convert_to_tensor=True,
                                                         normalize_embeddings=True).float().cpu()
        return _encoders[name]


def train(job: Job, dataset: str, base: str = PRETRAINED["minilm-multi"][1], epochs: int = 30,
          lr: float = 0.01, val_ratio: float = 0.2, **_):
    import torch

    samples = storage.list_items(dataset)["items"]
    classes = sorted({s["label"] for s in samples})
    if len(classes) < 2:
        raise ValueError("文字分類至少需要 2 個類別")

    rng = random.Random(0)
    by_cls = {c: [s for s in samples if s["label"] == c] for c in classes}
    train_s, val_s = [], []
    for c, group in by_cls.items():
        rng.shuffle(group)
        n_val = int(len(group) * val_ratio) if len(group) >= 3 else 0
        val_s += group[:n_val]
        train_s += group[n_val:]
    job.log(f"共 {len(samples)} 筆：訓練 {len(train_s)}、驗證 {len(val_s)}")

    job.log(f"載入文字編碼器 {base}（第一次使用會自動下載）")
    encode = get_encoder(base)
    job.log("把每一句話轉成向量（embedding）…")
    x_train = encode([s["text"] for s in train_s])
    y_train = torch.tensor([classes.index(s["label"]) for s in train_s])
    x_val = encode([s["text"] for s in val_s]) if val_s else None
    y_val = torch.tensor([classes.index(s["label"]) for s in val_s]) if val_s else None

    torch.manual_seed(0)
    head = torch.nn.Linear(x_train.shape[1], len(classes))
    opt = torch.optim.Adam(head.parameters(), lr=lr)
    loss_fn = torch.nn.CrossEntropyLoss()
    batch = 16
    metrics = {}
    for epoch in range(1, epochs + 1):
        job.check_cancel()
        head.train()
        perm = torch.randperm(len(x_train))
        total = 0.0
        for i in range(0, len(perm), batch):
            idx = perm[i:i + batch]
            opt.zero_grad()
            loss = loss_fn(head(x_train[idx]), y_train[idx])
            loss.backward()
            opt.step()
            total += loss.item() * len(idx)
        head.eval()
        with torch.no_grad():
            train_acc = (head(x_train).argmax(1) == y_train).float().mean().item()
            metrics = {"metrics/accuracy": round(train_acc, 5)}
            if x_val is not None:
                val_logits = head(x_val)
                metrics = {"val/loss": round(loss_fn(val_logits, y_val).item(), 5),
                           "metrics/accuracy": round((val_logits.argmax(1) == y_val).float().mean().item(), 5)}
        job.emit("epoch", epoch=epoch, epochs=epochs,
                 train={"train/loss": round(total / len(x_train), 5)}, metrics=metrics)

    model_id, model_dir = storage.new_model_dir()
    torch.save(head.state_dict(), model_dir / "head.pt")
    meta = {"id": model_id, "task": "text_cls", "dataset": dataset, "classes": classes, "base": base,
            "dim": int(x_train.shape[1]), "epochs": epochs, "created": time.time(), "final_metrics": metrics}
    storage.save_model_meta(model_dir, meta)
    job.log(f"訓練完成，模型編號 {model_id}")
    return meta

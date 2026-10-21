"""圖片分類：以 YOLO11n-cls（ImageNet 預訓練）微調。"""
import os
import random
import shutil

from .. import storage
from ..config import RUNS_DIR
from ..jobs import Job
from . import ultra


def _link(src, dst):
    try:
        os.link(src, dst)  # 硬連結不佔空間；跨磁碟或不支援時改用複製
    except OSError:
        shutil.copy(src, dst)


def train(job: Job, dataset: str, base: str = "yolo11n-cls.pt", epochs: int = 10, val_ratio: float = 0.2, **_):
    d = storage.dataset_dir(dataset)
    meta = storage.get_meta(dataset)
    classes = [c for c in meta["classes"] if any((d / "images" / c).glob("*.jpg"))]
    if len(classes) < 2:
        raise ValueError("圖片分類至少需要 2 個有圖片的類別")

    # Ultralytics 分類需要 train/<類別>、val/<類別> 的資料夾結構
    root = RUNS_DIR / f"data-{job.id}"
    rng = random.Random(0)
    for cls in classes:
        files = sorted((d / "images" / cls).glob("*.jpg"))
        rng.shuffle(files)
        n_val = max(1, int(len(files) * val_ratio))
        val = files[:n_val]
        train_files = files[n_val:] or files  # 只有 1 張時訓練與驗證共用
        for split, group in (("train", train_files), ("val", val)):
            out = root / split / cls
            out.mkdir(parents=True, exist_ok=True)
            for f in group:
                _link(f, out / f.name)
        job.log(f"類別「{cls}」：訓練 {len(train_files)} 張、驗證 {len(val)} 張")

    try:
        return ultra.run(job, "image_cls", base, str(root), dataset, classes,
                         epochs=epochs, imgsz=224, batch=16)
    finally:
        shutil.rmtree(root, ignore_errors=True)

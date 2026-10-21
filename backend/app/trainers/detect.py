"""物件偵測：以 YOLO11（COCO 預訓練）微調。"""
import random
import shutil

from .. import storage
from ..config import RUNS_DIR
from ..jobs import Job
from . import ultra


def train(job: Job, dataset: str, base: str = "yolo11n.pt", epochs: int = 20, val_ratio: float = 0.2, **_):
    d = storage.dataset_dir(dataset)
    meta = storage.get_meta(dataset)
    classes = meta["classes"]
    if not classes:
        raise ValueError("請先在標註工具中新增類別")

    # 只使用已標註的圖片（標註檔存在即可，空檔代表「這張沒有物件」）
    images = sorted(p for p in (d / "images").glob("*.jpg") if (d / "labels" / f"{p.stem}.txt").exists())
    if len(images) < 2:
        raise ValueError("至少需要 2 張已標註的圖片")
    rng = random.Random(0)
    rng.shuffle(images)
    n_val = max(1, int(len(images) * val_ratio))
    val, train_imgs = images[:n_val], images[n_val:]
    job.log(f"已標註 {len(images)} 張：訓練 {len(train_imgs)}、驗證 {len(val)}")

    # Ultralytics 會把路徑中的 /images/ 換成 /labels/ 找標註，正好符合資料集結構
    root = RUNS_DIR / f"data-{job.id}"
    root.mkdir(parents=True, exist_ok=True)
    (root / "train.txt").write_text("\n".join(str(p) for p in train_imgs), "utf-8")
    (root / "val.txt").write_text("\n".join(str(p) for p in val), "utf-8")
    names = "\n".join(f"  {i}: {c!r}" for i, c in enumerate(classes))
    yaml_path = root / "data.yaml"
    yaml_path.write_text(f"path: {root.as_posix()}\ntrain: train.txt\nval: val.txt\nnames:\n{names}\n", "utf-8")

    try:
        return ultra.run(job, "detect", base, str(yaml_path), dataset, classes,
                         epochs=epochs, imgsz=640, batch=8)
    finally:
        shutil.rmtree(root, ignore_errors=True)

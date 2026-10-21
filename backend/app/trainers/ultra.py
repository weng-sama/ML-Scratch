"""Ultralytics 共用訓練流程：把每個 epoch 的 loss 與指標轉成前端看得懂的事件。"""
import shutil
import time
from pathlib import Path

from .. import device, storage
from ..config import RUNS_DIR
from ..jobs import Job
from . import weights_path


def _floats(d: dict):
    out = {}
    for k, v in (d or {}).items():
        try:
            out[k] = round(float(v), 5)
        except (TypeError, ValueError):
            pass
    return out


def run(job: Job, task: str, weights: str, data: str, dataset: str, classes: list[str],
        epochs: int, imgsz: int, batch: int, extra_meta: dict | None = None):
    from ultralytics import YOLO

    dev = device.info()
    job.log(f"使用裝置：{dev['name']}（{dev['device']}）")
    job.log(f"載入預訓練權重 {weights}（第一次使用會自動下載）")
    model = YOLO(weights_path(weights))
    batches = {"n": 0}

    def on_batch_end(trainer):
        batches["n"] += 1
        if batches["n"] % 5 == 0:
            job.emit("batch", epoch=trainer.epoch + 1, n=batches["n"])
        if job.cancel_requested:
            trainer.stop = True

    emitted = set()

    def on_fit_epoch_end(trainer):
        # 訓練結束時 Ultralytics 可能再觸發一次（最終驗證），同一個 epoch 只回報一次
        epoch = min(trainer.epoch + 1, trainer.epochs)
        if epoch not in emitted:
            emitted.add(epoch)
            train = _floats(trainer.label_loss_items(trainer.tloss, prefix="train"))
            job.emit("epoch", epoch=epoch, epochs=trainer.epochs, train=train, metrics=_floats(trainer.metrics))
        if job.cancel_requested:
            trainer.stop = True

    model.add_callback("on_train_batch_end", on_batch_end)
    model.add_callback("on_fit_epoch_end", on_fit_epoch_end)

    run_name = f"{job.id}-{int(time.time())}"
    model.train(data=data, epochs=epochs, imgsz=imgsz, batch=batch, device=dev["ultralytics"],
                workers=0, project=str(RUNS_DIR), name=run_name, exist_ok=True,
                plots=False, verbose=False, amp=dev["device"] == "cuda")
    job.check_cancel()

    best = Path(model.trainer.best)
    if not best.exists():
        best = Path(model.trainer.last)
    model_id, model_dir = storage.new_model_dir()
    shutil.copy(best, model_dir / "weights.pt")
    meta = {"id": model_id, "task": task, "dataset": dataset, "classes": classes,
            "base": weights, "epochs": epochs, "created": time.time(),
            "final_metrics": _floats(model.trainer.metrics), **(extra_meta or {})}
    storage.save_model_meta(model_dir, meta)
    job.log(f"訓練完成，模型編號 {model_id}")
    return meta

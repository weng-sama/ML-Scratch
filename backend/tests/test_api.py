import base64
import io
import os
import sys
import tempfile
import time
from pathlib import Path

import pytest

os.environ["ML_SCRATCH_HOME"] = tempfile.mkdtemp(prefix="mlscratch-test-")
os.environ["ML_SCRATCH_TOKEN"] = "test-token"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402

from app import jobs  # noqa: E402
from app.main import app  # noqa: E402
from app.trainers import text_cls  # noqa: E402

H = {"x-token": "test-token"}
client = TestClient(app)


def img_b64(color=(255, 0, 0)):
    buf = io.BytesIO()
    Image.new("RGB", (64, 48), color).save(buf, "PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def wait_job(job_id, timeout=120):
    end = time.time() + timeout
    while time.time() < end:
        job = jobs.get(job_id)
        if job.status != "running":
            return job
        time.sleep(0.1)
    raise TimeoutError(job_id)


def test_token_required():
    assert client.get("/health").status_code == 200
    assert client.get("/datasets").status_code == 401
    assert client.get("/datasets", headers=H).status_code == 200


def test_rejects_path_traversal():
    r = client.post("/datasets", json={"name": "../evil", "task": "image_cls"}, headers=H)
    assert r.status_code == 400
    r = client.get("/datasets/..%2F..%2Fetc", headers=H)
    assert r.status_code in (400, 404)


def test_image_cls_dataset_and_folder_import(tmp_path):
    assert client.post("/datasets", json={"name": "水果", "task": "image_cls"}, headers=H).status_code == 200
    r = client.post("/datasets/水果/images", json={"image": img_b64(), "label": "蘋果"}, headers=H)
    assert r.status_code == 200, r.text
    item_id = r.json()["id"]
    for cls, color in (("香蕉", (255, 255, 0)), ("葡萄", (128, 0, 128))):
        (tmp_path / cls).mkdir()
        for i in range(2):
            Image.new("RGB", (32, 32), color).save(tmp_path / cls / f"{i}.png")
    r = client.post("/datasets/水果/import-folder", json={"path": str(tmp_path)}, headers=H)
    assert r.json() == {"imported": 4}
    data = client.get("/datasets/水果", headers=H).json()
    assert data["meta"]["classes"][0] == "蘋果"
    assert set(data["meta"]["classes"]) == {"蘋果", "香蕉", "葡萄"}
    assert len(data["items"]) == 5
    r = client.get(f"/datasets/水果/images/{item_id}?token=test-token")
    assert r.headers["content-type"] == "image/jpeg"
    assert client.delete(f"/datasets/水果/items/{item_id}", headers=H).status_code == 200
    assert len(client.get("/datasets/水果", headers=H).json()["items"]) == 4


def test_detect_boxes_roundtrip():
    client.post("/datasets", json={"name": "det", "task": "detect"}, headers=H)
    client.put("/datasets/det/classes", json={"classes": ["cat", "dog"]}, headers=H)
    item_id = client.post("/datasets/det/images", json={"image": img_b64()}, headers=H).json()["id"]
    assert client.get("/datasets/det", headers=H).json()["items"][0]["labeled"] is False
    boxes = [{"cls": 1, "x": 0.5, "y": 0.5, "w": 0.2, "h": 0.3}]
    assert client.put(f"/datasets/det/boxes/{item_id}", json={"boxes": boxes}, headers=H).status_code == 200
    assert client.get(f"/datasets/det/boxes/{item_id}", headers=H).json() == boxes
    assert client.get("/datasets/det", headers=H).json()["items"][0]["labeled"] is True
    bad = [{"cls": 5, "x": 0.5, "y": 0.5, "w": 0.2, "h": 0.3}]
    assert client.put(f"/datasets/det/boxes/{item_id}", json={"boxes": bad}, headers=H).status_code == 400
    # 偵測資料集不可刪除類別
    assert client.put("/datasets/det/classes", json={"classes": ["cat"]}, headers=H).status_code == 400


def test_task_mismatch():
    client.post("/datasets", json={"name": "txt-mismatch", "task": "text_cls"}, headers=H)
    r = client.post("/train", json={"dataset": "txt-mismatch", "base": "yolo11n", "epochs": 1}, headers=H)
    assert r.status_code == 400


def fake_encoder(_name):
    import torch

    def encode(texts):
        # 以「開心」「難過」關鍵字產生可分的特徵，取代真正的句向量模型
        return torch.tensor([[float("開心" in t), float("難過" in t), len(t) / 10] for t in texts])

    return encode


def test_text_training_and_prediction(tmp_path, monkeypatch):
    monkeypatch.setattr(text_cls, "get_encoder", fake_encoder)
    csv_path = tmp_path / "data.csv"
    rows = ["text,label"] + [f"今天好開心{i},正面" for i in range(6)] + [f"我很難過{i},負面" for i in range(6)]
    csv_path.write_bytes("\n".join(rows).encode("cp950"))  # 模擬 Excel 存出的 Big5 CSV
    client.post("/datasets", json={"name": "心情", "task": "text_cls"}, headers=H)
    assert client.post("/datasets/心情/import-csv", json={"path": str(csv_path)}, headers=H).json() == {"imported": 12}
    client.post("/datasets/心情/texts", json={"text": "超開心", "label": "正面"}, headers=H)

    r = client.post("/train", json={"dataset": "心情", "base": "minilm-multi", "epochs": 40}, headers=H)
    assert r.status_code == 200, r.text
    job_id = r.json()["id"]
    with client.websocket_connect(f"/ws/jobs/{job_id}?token=test-token") as ws:
        events = []
        while True:
            try:
                events.append(ws.receive_json())
            except Exception:
                break
    types = [e["type"] for e in events]
    assert types.count("epoch") == 40, types
    assert types[-1] == "done", events[-1]
    model_id = events[-1]["result"]["id"]
    epochs = [e for e in events if e["type"] == "epoch"]
    assert epochs[-1]["train"]["train/loss"] < epochs[0]["train"]["train/loss"]

    r = client.post("/predict", json={"model": model_id, "text": "真的很開心"}, headers=H)
    assert r.status_code == 200, r.text
    assert r.json()["label"] == "正面"
    r = client.post("/predict", json={"model": model_id, "text": "有點難過"}, headers=H)
    assert r.json()["label"] == "負面"
    assert any(m["id"] == model_id for m in client.get("/models", headers=H).json())


def test_cancel_job():
    def slow(job):
        for _ in range(100):
            job.check_cancel()
            time.sleep(0.05)

    job = jobs.start("test", {}, slow)
    client.post(f"/jobs/{job.id}/cancel", headers=H)
    assert wait_job(job.id).status == "cancelled"


def test_llm_catalog_and_missing_model():
    models = client.get("/llm/models", headers=H).json()
    assert {m["key"] for m in models} == {"qwen2.5-0.5b", "qwen2.5-1.5b"}
    r = client.post("/llm/chat", json={"model": "qwen2.5-0.5b", "messages": [{"role": "user", "content": "hi"}]},
                    headers=H)
    assert r.status_code == 404
    assert client.post("/llm/chat", json={"model": "nope", "messages": []}, headers=H).status_code == 400


@pytest.mark.skipif(os.environ.get("ML_SCRATCH_SLOW") != "1", reason="需要 ultralytics，設 ML_SCRATCH_SLOW=1 執行")
def test_detect_training_smoke():
    """以未預訓練的 yolo11n.yaml 跑 1 個 epoch，驗證資料轉換與回呼流程（不需網路）。"""
    from app.trainers import detect

    client.post("/datasets", json={"name": "det-train", "task": "detect"}, headers=H)
    client.put("/datasets/det-train/classes", json={"classes": ["紅", "藍"]}, headers=H)
    for i in range(4):
        item = client.post("/datasets/det-train/images", json={"image": img_b64((50 * i, 0, 0))}, headers=H).json()
        boxes = [{"cls": i % 2, "x": 0.5, "y": 0.5, "w": 0.4, "h": 0.4}]
        client.put(f"/datasets/det-train/boxes/{item['id']}", json={"boxes": boxes}, headers=H)
    job = jobs.start("train", {}, lambda j: detect.train(j, dataset="det-train", base="yolo11n.yaml", epochs=1))
    job = wait_job(job.id, timeout=600)
    assert job.status == "done", job.events[-1]
    assert any(e["type"] == "epoch" for e in job.events)
    r = client.post("/predict", json={"model": job.result["id"], "image": img_b64()}, headers=H)
    assert r.status_code == 200, r.text
    assert r.json()["task"] == "detect"


@pytest.mark.skipif(os.environ.get("ML_SCRATCH_SLOW") != "1", reason="需要 ultralytics，設 ML_SCRATCH_SLOW=1 執行")
def test_image_cls_training_smoke():
    from app.trainers import image_cls

    client.post("/datasets", json={"name": "cls-train", "task": "image_cls"}, headers=H)
    for label, color in (("紅", (255, 0, 0)), ("藍", (0, 0, 255))):
        for _ in range(3):
            client.post("/datasets/cls-train/images", json={"image": img_b64(color), "label": label}, headers=H)
    job = jobs.start("train", {}, lambda j: image_cls.train(j, dataset="cls-train", base="yolo11n-cls.yaml", epochs=1))
    job = wait_job(job.id, timeout=600)
    assert job.status == "done", job.events[-1]
    assert [e["epoch"] for e in job.events if e["type"] == "epoch"] == [1]
    r = client.post("/predict", json={"model": job.result["id"], "image": img_b64()}, headers=H)
    assert r.status_code == 200, r.text
    assert r.json()["label"] in ("紅", "藍")

"""ML-Scratch 後端 API（FastAPI）。由 Electron 主程序以子程序啟動，只監聽 127.0.0.1。"""
import asyncio

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from . import jobs, llm, predict, storage
from .config import HOME, TOKEN
from .trainers import PRETRAINED, trainer_for

VERSION = "1.0.0"
app = FastAPI(title="ML-Scratch backend", version=VERSION)
# 前端從 file:// 載入（origin 為 null）；安全性由每次啟動產生的權杖把關
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def require_token(request: Request, call_next):
    if request.method != "OPTIONS" and request.url.path != "/health":
        token = request.headers.get("x-token") or request.query_params.get("token")
        if token != TOKEN:
            return JSONResponse({"detail": "權杖錯誤"}, status_code=401)
    return await call_next(request)


@app.exception_handler(ValueError)
async def value_error(_, exc):
    return JSONResponse({"detail": str(exc)}, status_code=400)


@app.exception_handler(FileNotFoundError)
async def not_found(_, exc):
    return JSONResponse({"detail": str(exc)}, status_code=404)


@app.get("/health")
def health():
    return {"ok": True, "version": VERSION}


@app.get("/system")
def system():
    from . import device
    return {"home": str(HOME), **device.info()}


# ---------- 資料集 ----------

class DatasetIn(BaseModel):
    name: str
    task: str


class ClassesIn(BaseModel):
    classes: list[str]


class ImageIn(BaseModel):
    image: str  # base64 或 data URL
    label: str | None = None


class FolderIn(BaseModel):
    path: str
    label: str | None = None


class TextIn(BaseModel):
    text: str
    label: str


class BoxesIn(BaseModel):
    boxes: list[dict]


@app.get("/datasets")
def list_datasets():
    return storage.list_datasets()


@app.post("/datasets")
def create_dataset(body: DatasetIn):
    return storage.create_dataset(body.name, body.task)


@app.get("/datasets/{name}")
def get_dataset(name: str):
    return storage.list_items(name)


@app.put("/datasets/{name}/classes")
def set_classes(name: str, body: ClassesIn):
    return storage.set_classes(name, body.classes)


@app.post("/datasets/{name}/images")
def add_image(name: str, body: ImageIn):
    return storage.add_image(name, body.image, body.label)


@app.post("/datasets/{name}/import-folder")
def import_folder(name: str, body: FolderIn):
    return storage.import_folder(name, body.path, body.label)


@app.post("/datasets/{name}/import-csv")
def import_csv(name: str, body: FolderIn):
    return storage.import_csv(name, body.path)


@app.post("/datasets/{name}/texts")
def add_text(name: str, body: TextIn):
    return storage.add_text(name, body.text, body.label)


@app.get("/datasets/{name}/images/{item_id}")
def get_image(name: str, item_id: str):
    return FileResponse(storage.image_path(name, item_id), media_type="image/jpeg")


@app.delete("/datasets/{name}/items/{item_id}")
def delete_item(name: str, item_id: str):
    storage.delete_item(name, item_id)
    return {"ok": True}


@app.get("/datasets/{name}/boxes/{item_id}")
def get_boxes(name: str, item_id: str):
    return storage.get_boxes(name, item_id)


@app.put("/datasets/{name}/boxes/{item_id}")
def set_boxes(name: str, item_id: str, body: BoxesIn):
    storage.set_boxes(name, item_id, body.boxes)
    return {"ok": True}


# ---------- 模型、訓練、推論 ----------

class TrainIn(BaseModel):
    dataset: str
    base: str  # 預訓練模型 key
    epochs: int = 10


class PredictIn(BaseModel):
    model: str  # 模型編號或 "pretrained:<key>"
    image: str | None = None
    text: str | None = None
    conf: float = 0.25


@app.get("/pretrained")
def pretrained():
    return [{"key": k, "task": t, "label": label} for k, (t, _, label) in PRETRAINED.items()]


@app.get("/models")
def list_models():
    return storage.list_models()


@app.delete("/models/{model_id}")
def delete_model(model_id: str):
    storage.delete_model(model_id)
    predict.forget(model_id)
    return {"ok": True}


@app.post("/train")
def train(body: TrainIn):
    meta = storage.get_meta(body.dataset)
    if body.base not in PRETRAINED:
        raise ValueError(f"未知的預訓練模型：{body.base}")
    base_task, weights, _ = PRETRAINED[body.base]
    if base_task != meta["task"]:
        raise ValueError(f"預訓練模型（{base_task}）與資料集任務（{meta['task']}）不相符")
    if not 1 <= body.epochs <= 300:
        raise ValueError("訓練回合數需介於 1–300")
    fn = trainer_for(meta["task"])
    job = jobs.start("train", body.model_dump(),
                     lambda j: fn(j, dataset=body.dataset, base=weights, epochs=body.epochs))
    return job.summary()


@app.post("/predict")
def run_predict(body: PredictIn):
    if body.image:
        return predict.predict_image(body.model, body.image, body.conf)
    if body.text is not None:
        return predict.predict_text(body.model, body.text)
    raise ValueError("需要提供 image 或 text")


# ---------- LLM ----------

class ChatIn(BaseModel):
    model: str
    messages: list[dict]
    max_tokens: int = 256
    temperature: float = 0.7


@app.get("/llm/models")
def llm_models():
    return llm.list_models()


@app.post("/llm/download/{key}")
def llm_download(key: str):
    if key not in llm.CATALOG:
        raise ValueError(f"未知的 LLM：{key}")
    return jobs.start("download", {"key": key}, lambda j: llm.download(j, key)).summary()


@app.post("/llm/chat")
def llm_chat(body: ChatIn):
    return llm.chat(body.model, body.messages, body.max_tokens, body.temperature)


# ---------- 背景工作 ----------

@app.get("/jobs")
def list_jobs():
    return jobs.list_all()


@app.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str):
    jobs.get(job_id).cancel_requested = True
    return {"ok": True}


@app.websocket("/ws/jobs/{job_id}")
async def job_events(ws: WebSocket, job_id: str):
    if ws.query_params.get("token") != TOKEN:
        await ws.close(code=4401)
        return
    await ws.accept()
    try:
        job = jobs.get(job_id)
    except FileNotFoundError:
        await ws.close(code=4404)
        return
    idx = 0
    try:
        while True:
            events = job.events_since(idx)
            for ev in events:
                await ws.send_json(ev)
            idx += len(events)
            if job.status != "running" and not job.events_since(idx):
                break
            await asyncio.sleep(0.2)
        await ws.close()
    except WebSocketDisconnect:
        pass

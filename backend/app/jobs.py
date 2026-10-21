"""背景工作（訓練、下載模型）：以執行緒執行，事件存在記憶體中供 WebSocket 讀取。"""
import threading
import time
import traceback
import uuid


class Cancelled(Exception):
    pass


class Job:
    def __init__(self, kind: str, params: dict):
        self.id = uuid.uuid4().hex[:10]
        self.kind = kind
        self.params = params
        self.status = "running"  # running / done / error / cancelled
        self.events: list[dict] = []
        self.result = None
        self.cancel_requested = False
        self.created = time.time()
        self._lock = threading.Lock()

    def emit(self, type_: str, **data):
        with self._lock:
            self.events.append({"type": type_, "t": time.time(), **data})

    def log(self, msg: str):
        self.emit("log", msg=msg)

    def check_cancel(self):
        if self.cancel_requested:
            raise Cancelled()

    def events_since(self, idx: int):
        with self._lock:
            return self.events[idx:]

    def summary(self):
        return {"id": self.id, "kind": self.kind, "status": self.status, "params": self.params,
                "result": self.result, "created": self.created}


_jobs: dict[str, Job] = {}


def start(kind: str, params: dict, fn) -> Job:
    """fn(job) 在背景執行緒中執行，回傳值存為 job.result。"""
    job = Job(kind, params)
    _jobs[job.id] = job

    def run():
        try:
            job.result = fn(job)
            job.status = "done"
            job.emit("done", result=job.result)
        except Cancelled:
            job.status = "cancelled"
            job.emit("cancelled")
        except Exception as e:  # noqa: BLE001 - 所有錯誤都要回報給前端
            job.status = "error"
            job.emit("error", msg=str(e), trace=traceback.format_exc())

    threading.Thread(target=run, daemon=True, name=f"job-{job.id}").start()
    return job


def get(job_id: str) -> Job:
    if job_id not in _jobs:
        raise FileNotFoundError(f"找不到工作：{job_id}")
    return _jobs[job_id]


def list_all():
    return [j.summary() for j in sorted(_jobs.values(), key=lambda j: j.created, reverse=True)]

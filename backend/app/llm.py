"""本機 LLM：以 llama.cpp（llama-cpp-python）執行 GGUF 量化模型，首次使用時下載。"""
import os
import threading

from .config import LLM_DIR
from .jobs import Job

HF_ENDPOINT = os.environ.get("HF_ENDPOINT", "https://huggingface.co").rstrip("/")

# Qwen2.5 Instruct 0.5B／1.5B 為 Apache-2.0 授權，中文能力佳、CPU 可執行
CATALOG = {
    "qwen2.5-0.5b": {"repo": "Qwen/Qwen2.5-0.5B-Instruct-GGUF", "file": "qwen2.5-0.5b-instruct-q4_k_m.gguf",
                     "label": "Qwen2.5 0.5B（約 0.5 GB，最快）"},
    "qwen2.5-1.5b": {"repo": "Qwen/Qwen2.5-1.5B-Instruct-GGUF", "file": "qwen2.5-1.5b-instruct-q4_k_m.gguf",
                     "label": "Qwen2.5 1.5B（約 1.1 GB，較聰明）"},
}

_loaded: dict = {}
_locks: dict[str, threading.Lock] = {k: threading.Lock() for k in CATALOG}


def _path(key: str):
    if key not in CATALOG:
        raise ValueError(f"未知的 LLM：{key}")
    return LLM_DIR / CATALOG[key]["file"]


def list_models():
    return [{"key": k, "label": v["label"], "downloaded": _path(k).exists()} for k, v in CATALOG.items()]


def download(job: Job, key: str, **_):
    import requests

    dst = _path(key)
    if dst.exists():
        return {"key": key, "path": str(dst)}
    url = f"{HF_ENDPOINT}/{CATALOG[key]['repo']}/resolve/main/{CATALOG[key]['file']}"
    job.log(f"下載 {url}")
    part = dst.with_suffix(".part")
    with requests.get(url, stream=True, timeout=30) as r:
        r.raise_for_status()
        total = int(r.headers.get("content-length", 0))
        done = 0
        last = -1
        with part.open("wb") as f:
            for chunk in r.iter_content(1 << 20):
                job.check_cancel()
                f.write(chunk)
                done += len(chunk)
                pct = int(done * 100 / total) if total else 0
                if pct != last:
                    last = pct
                    job.emit("download", done=done, total=total, pct=pct)
    part.replace(dst)
    return {"key": key, "path": str(dst)}


def _get(key: str):
    if key not in _loaded:
        path = _path(key)
        if not path.exists():
            raise FileNotFoundError(f"尚未下載 {CATALOG[key]['label']}")
        from llama_cpp import Llama
        _loaded[key] = Llama(model_path=str(path), n_ctx=4096, n_threads=max(1, (os.cpu_count() or 2) - 1),
                             verbose=False)
    return _loaded[key]


def chat(key: str, messages: list[dict], max_tokens: int = 256, temperature: float = 0.7):
    """messages: [{"role": "system"|"user"|"assistant", "content": str}]"""
    _path(key)  # 驗證 key
    with _locks[key]:  # 同一個模型實例不能並行生成
        out = _get(key).create_chat_completion(messages=messages, max_tokens=max_tokens, temperature=temperature)
    return {"reply": out["choices"][0]["message"]["content"].strip()}

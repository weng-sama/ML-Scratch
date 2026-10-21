"""偵測可用的運算裝置：有 NVIDIA GPU 用 CUDA，Apple Silicon 用 MPS，否則用 CPU。"""
from functools import lru_cache


@lru_cache
def info():
    import torch

    if torch.cuda.is_available():
        return {"device": "cuda", "ultralytics": 0, "name": torch.cuda.get_device_name(0), "torch": torch.__version__}
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return {"device": "mps", "ultralytics": "mps", "name": "Apple GPU", "torch": torch.__version__}
    return {"device": "cpu", "ultralytics": "cpu", "name": "CPU", "torch": torch.__version__}

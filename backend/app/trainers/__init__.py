"""各任務的遷移學習訓練器與預訓練模型清單。"""
from ..config import HOME

# 預訓練模型：key -> (任務, 權重來源, 顯示名稱)
PRETRAINED = {
    "yolo11n": ("detect", "yolo11n.pt", "YOLO11n 物件偵測（COCO 80 類）"),
    "yolo11s": ("detect", "yolo11s.pt", "YOLO11s 物件偵測（較準、較慢）"),
    "yolo11n-cls": ("image_cls", "yolo11n-cls.pt", "YOLO11n 圖片分類（ImageNet 1000 類）"),
    "minilm-multi": ("text_cls", "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
                     "MiniLM 多語言文字編碼器（需先訓練）"),
}


def trainer_for(task: str):
    if task == "image_cls":
        from .image_cls import train
    elif task == "detect":
        from .detect import train
    elif task == "text_cls":
        from .text_cls import train
    else:
        raise ValueError(f"未知的任務類型：{task}")
    return train


def weights_path(name: str) -> str:
    """Ultralytics 權重統一下載到 HOME/weights（預設會下載到目前工作目錄）。"""
    if not name.endswith(".pt"):
        return name  # .yaml 等模型設定檔不需下載
    from ultralytics.utils.downloads import attempt_download_asset

    path = HOME / "weights" / name
    path.parent.mkdir(parents=True, exist_ok=True)
    return str(attempt_download_asset(path))

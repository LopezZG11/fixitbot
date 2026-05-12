from fastapi import FastAPI, UploadFile, File, HTTPException, Query
from ultralytics import YOLO
from PIL import Image, UnidentifiedImageError
import numpy as np
import io
from threading import Lock

# ===================== (AGREGADO) Auto-descarga del modelo =====================
import os
import urllib.request
from pathlib import Path

WEIGHTS_DIR = Path("weights")
WEIGHTS_DIR.mkdir(parents=True, exist_ok=True)

MODEL_PATH = WEIGHTS_DIR / "yolov11-seg-cardd.pt"
MODEL_URL = os.getenv("MODEL_URL", "").strip()

def ensure_model():
    if MODEL_PATH.exists():
        return
    if not MODEL_URL:
        raise RuntimeError(
            "No existe weights/yolov11-seg-cardd.pt y falta MODEL_URL (URL pública del .pt)."
        )

    print(f"[boot] Descargando modelo desde: {MODEL_URL}")

    # --- (CLAVE) Simular navegador para evitar 403 de Cloudflare ---
    req = urllib.request.Request(
        MODEL_URL,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                          "AppleWebKit/537.36 (KHTML, like Gecko) "
                          "Chrome/123.0.0.0 Safari/537.36",
            "Accept": "*/*",
        },
        method="GET",
    )

    with urllib.request.urlopen(req, timeout=120) as r, open(MODEL_PATH, "wb") as f:
        # descarga por chunks para archivos grandes
        while True:
            chunk = r.read(1024 * 1024)  # 1 MB
            if not chunk:
                break
            f.write(chunk)

    print(f"[boot] Modelo guardado en: {MODEL_PATH}")
# ===============================================================================

app = FastAPI()

MODEL_LOCK = Lock()

# ===================== (AGREGADO) Asegurar modelo antes de cargar YOLO =========
ensure_model()
# ===============================================================================

model = YOLO("weights/yolov11-seg-cardd.pt")
CLASSES = ["crack", "dent", "glass shatter", "lamp broken", "scratch", "tire flat"]

# Ajustes “normales”
IMGSZ = 1280
CONF_MAIN = 0.40
IOU = 0.55

# Ajustes “debug”
CONF_DEBUG = 0.10  # baja para ver candidatos (0.05–0.15)

@app.get("/")
def health():
    return {"ok": True, "endpoint": "/predict"}

def _run_predict(img_np, conf_val: float):
    with MODEL_LOCK:
        return model.predict(
            img_np,
            imgsz=IMGSZ,
            conf=conf_val,
            iou=IOU,
            verbose=False
        )[0]

def _pack_preds(r):
    preds = []

    if r.boxes is None or len(r.boxes) == 0:
        return preds

    masks = None
    if r.masks is not None and r.masks.data is not None:
        masks = r.masks.data  # (N, Hm, Wm)

    for i in range(len(r.boxes)):
        cls_id = int(r.boxes.cls[i].item())
        conf_i = float(r.boxes.conf[i].item())
        x1, y1, x2, y2 = [float(v) for v in r.boxes.xyxy[i].tolist()]

        bw = max(0.0, x2 - x1)
        bh = max(0.0, y2 - y1)
        cx = x1 + bw / 2.0
        cy = y1 + bh / 2.0

        area_pct = None
        if masks is not None and i < len(masks):
            m = masks[i].cpu().numpy()
            m = (m > 0.5)
            area_pct = float(m.sum()) / float(m.shape[0] * m.shape[1])

        preds.append({
            "x": cx, "y": cy,
            "width": bw, "height": bh,
            "class": CLASSES[cls_id] if 0 <= cls_id < len(CLASSES) else str(cls_id),
            "confidence": conf_i,
            "area_pct": area_pct
        })

    return preds

@app.post("/predict")
async def predict(
    file: UploadFile = File(...),
    debug: int = Query(0, description="1=incluye raw preds y top-k"),
    topk: int = Query(5, description="top-k para debug")
):
    try:
        data = await file.read()
        if not data:
            raise HTTPException(status_code=400, detail="Archivo vacío")

        try:
            img = Image.open(io.BytesIO(data)).convert("RGB")
        except UnidentifiedImageError:
            raise HTTPException(status_code=400, detail="Imagen inválida o corrupta")

        img_np = np.array(img)
        h, w = img_np.shape[:2]

        # Inferencia normal (la que usa tu app)
        r_main = _run_predict(img_np, CONF_MAIN)
        preds_main = _pack_preds(r_main)

        resp = {
            "image": {"width": w, "height": h},
            "predictions": preds_main
        }

        if debug == 1:
            # Inferencia debug (más laxa) para ver candidatos
            r_dbg = _run_predict(img_np, CONF_DEBUG)
            preds_dbg = _pack_preds(r_dbg)

            # Top-k por confianza
            preds_dbg_sorted = sorted(preds_dbg, key=lambda p: p.get("confidence", 0), reverse=True)
            top = preds_dbg_sorted[: max(1, int(topk))]

            resp["debug"] = {
                "imgsz": IMGSZ,
                "iou": IOU,
                "conf_main": CONF_MAIN,
                "conf_debug": CONF_DEBUG,
                "raw_boxes_count": len(preds_dbg),
                "raw_classes": [{"cls": p["class"], "confidence": p["confidence"]} for p in top],
                "raw_top": top,
                "main_boxes_count": len(preds_main),
            }

# ---- Weak-signal automático (solo si main no detectó nada) ----
        if len(preds_main) == 0 and debug == 0:
            r_dbg = _run_predict(img_np, CONF_DEBUG)
            preds_dbg = _pack_preds(r_dbg)

            preds_dbg_sorted = sorted(preds_dbg, key=lambda p: p.get("confidence", 0), reverse=True)
            top = preds_dbg_sorted[:3]

            resp["weak_signal"] = len(top) > 0
            resp["weak_top"] = [{"cls": p["class"], "confidence": p["confidence"]} for p in top]
        else:
            resp["weak_signal"] = False
            resp["weak_top"] = []

        return resp

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Predict failed: {type(e).__name__}: {e}")
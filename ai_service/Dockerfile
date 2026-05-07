FROM python:3.11-slim
WORKDIR /app

# ---- (IMPORTANTE) dependencias nativas que necesita opencv/cv2 ----
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libgl1 \
    libsm6 \
    libxext6 \
    libxrender1 \
    libxcb1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Render suele inyectar PORT. Si no existe, usamos 8001.
CMD ["sh","-c","uvicorn main:app --host 0.0.0.0 --port ${PORT:-8001}"]
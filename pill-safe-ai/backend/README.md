# Backend (FastAPI)

## Run (CPU venv)

```powershell
cd D:\Dev\pill-safe-ai
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
```

## Run (GPU venv, EasyOCR on CUDA)

This project enables EasyOCR GPU usage when PyTorch CUDA is available (see `/gpu/status`).

### Notes for RTX 5080 (sm_120)

Stable PyTorch CUDA wheels (e.g. `+cu124`) do **not** include kernels for `sm_120`, which leads to errors like:

- `CUDA error: no kernel image is available for execution on the device`

Use a newer build (typically **PyTorch nightly** with a newer CUDA runtime, e.g. `cu128`).

### Setup

```powershell
cd D:\Dev\pill-safe-ai

# Create GPU venv (choose a Python you have installed)
py -3.13 -m venv .venv-gpu

# Install PyTorch nightly CUDA build (example: cu128)
.\.venv-gpu\Scripts\python.exe -m pip install --upgrade pip
.\.venv-gpu\Scripts\python.exe -m pip install --upgrade --pre --index-url https://download.pytorch.org/whl/nightly/cu128 torch torchvision torchaudio

# Install backend deps (EasyOCR, FastAPI, etc.)
.\.venv-gpu\Scripts\python.exe -m pip install -r backend\requirements.txt
```

### Run + verify

```powershell
cd D:\Dev\pill-safe-ai
.\.venv-gpu\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload

# Verify GPU status
Invoke-RestMethod -Uri 'http://127.0.0.1:8000/gpu/status' -Method Get | ConvertTo-Json -Depth 6
```

Optional override:

- Set `OCR_USE_GPU=1` to force attempting GPU.
- Set `OCR_USE_GPU=0` to force CPU.

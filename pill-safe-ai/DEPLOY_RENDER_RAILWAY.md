# Render / Railway deployment

This repository is deployable as two services:

- `backend`: FastAPI API with OCR and model inference
- `frontend`: Vite app built to static files

## Before deploying

1. Make sure runtime data is actually present in the repository or another reachable storage location.
2. Rotate any real secrets that were ever stored in local `.env` files.
3. Set production origins in `CORS_ALLOWED_ORIGINS`.

Important runtime files used by the backend:

- `backend/scripts/best_model.pt`
- `backend/data/pill_data_final_remake 1.json`
- `backend/data/pharmacies_seoul_utf8.csv` if you rely on the local pharmacy CSV

If those files are only on your local machine and not committed, Render and Railway builds from Git will not have them.

## Render

This repo includes `render.yaml`.

### Backend

Create the backend service from the blueprint or manually:

- Environment: Docker
- Dockerfile: `backend/Dockerfile`
- Health check: `/health`

Required environment variables:

- `CORS_ALLOWED_ORIGINS=https://<your-frontend>.onrender.com`
- `AZURE_VISION_KEY`
- `AZURE_VISION_ENDPOINT`
- `AZURE_SPEECH_KEY`
- `AZURE_SPEECH_REGION`
- `ODCLOUD_SERVICE_KEY` or `ODCLOUD_AUTHORIZATION`
- `PHARMACY_SERVICE_PATH` if you do not bundle a local CSV
- `DUR_SERVICE_PATH`

Optional environment variables:

- `PHARMACY_LOCAL_CSV=backend/data/pharmacies_seoul_utf8.csv`

### Frontend

Create a static site:

- Root directory: `frontend`
- Build command: `npm ci && npm run build`
- Publish directory: `dist`

Set both frontend environment variables to the backend URL:

- `VITE_FLASK_BASE=https://careflow-webapp.onrender.com`
- `VITE_FASTAPI_BASE=https://careflow-webapp.onrender.com`

The frontend still uses both names, but the current deployed backend can answer both route groups.
If you deploy the backend under a different Render service name, update these URLs to match that final backend subdomain.

## Railway

Railway does not need a special manifest for this setup if you deploy with Docker.

### Backend service

- Service root: repository root
- Dockerfile path: `backend/Dockerfile`
- Start command: use the Dockerfile default

Set the same backend environment variables listed in the Render section.

### Frontend service

- Service root: repository root
- Dockerfile path: `frontend/Dockerfile`

Set build arguments or environment values before building:

- `VITE_FLASK_BASE=https://pill-safe-api.up.railway.app`
- `VITE_FASTAPI_BASE=https://pill-safe-api.up.railway.app`

For Railway backend CORS, use:

- `CORS_ALLOWED_ORIGINS=https://pill-safe-web.up.railway.app`

If Railway only offers runtime env vars for your frontend service, use the static Render deployment path instead, because Vite injects these values at build time.

## Quick smoke checks

After deployment, verify:

1. `GET /health` returns `{"status":"ok","service":"fastapi"}`
2. The frontend loads without CORS errors
3. `GET /api/pharmacies/status` responds from the deployed UI
4. OCR and pill-image endpoints return expected responses with production credentials

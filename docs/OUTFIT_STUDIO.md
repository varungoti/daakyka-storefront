# Virtual Try-On Studio (AR)

CPU-based AR try-on for `/mix-and-match/studio` using **MediaPipe pose detection + OpenCV garment overlay**.

Based on the OpenCV + MediaPipe approach described in [Seven Square's AR try-on guide](https://www.sevensquaretech.com/python-ar-try-on-shopping-app-code-github/#section01).

> **OutfitAnyone (GPU)** is deferred — too slow for real-time UX without dedicated GPU infrastructure.

## Enable

```env
NEXT_PUBLIC_OUTFIT_STUDIO=1
AR_TRYON_SERVICE_URL=http://localhost:8080
```

## Run AR service

```bash
# Docker (recommended)
docker compose up -d ar-tryon

# Or local Python
cd services/ar-tryon
python -m venv .venv
.venv\Scripts\activate   # Windows
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8080
```

Health: `GET http://localhost:8080/health`

## How it works

1. Studio resolves Shopify/seed variant images (size + color).
2. `POST /api/outfit/try-on` proxies to `AR_TRYON_SERVICE_URL/predict`.
3. AR service downloads preset avatar + garment images.
4. MediaPipe detects shoulders/hips on the avatar.
5. Garments are scaled and alpha-blended onto the torso.
6. Returns `data:image/jpeg;base64,...` for instant preview.

## API

```json
POST /predict
{
  "gender": "female",
  "top_garment_url": "https://...",
  "bottom_garment_url": "https://...",
  "avatar_url": "https://..."
}
```

## Future: OutfitAnyone GPU

When GPU infra is ready, add `services/outfit-anyone/` as an optional backend and switch via env `TRYON_BACKEND=ar|outfit-anyone`.

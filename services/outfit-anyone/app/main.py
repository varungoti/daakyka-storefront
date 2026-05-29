from __future__ import annotations

import hashlib
import os
from typing import Literal

import httpx
from fastapi import FastAPI
from pydantic import BaseModel, HttpUrl

app = FastAPI(title="DAAKYKA OutfitAnyone Service", version="0.1.0")

CACHE: dict[str, str] = {}

AVATAR_PRESETS = {
    "male": "https://images.pexels.com/photos/5327656/pexels-photo-5327656.jpeg?auto=compress&cs=tinysrgb&w=800",
    "female": "https://images.pexels.com/photos/4173251/pexels-photo-4173251.jpeg?auto=compress&cs=tinysrgb&w=800",
}


class PredictRequest(BaseModel):
    gender: Literal["male", "female"] = "female"
    top_garment_url: HttpUrl
    bottom_garment_url: HttpUrl | None = None
    top_handle: str | None = None
    bottom_handle: str | None = None
    color: str | None = None


class PredictResponse(BaseModel):
    ok: bool
    mode: Literal["outfit-anyone", "composite", "fallback"]
    result_image_url: str
    job_id: str
    cached: bool = False


def cache_key(payload: PredictRequest) -> str:
    raw = f"{payload.gender}|{payload.top_garment_url}|{payload.bottom_garment_url}|{payload.color}"
    return hashlib.sha256(raw.encode()).hexdigest()


@app.get("/health")
async def health() -> dict[str, object]:
    return {
        "ok": True,
        "service": "outfit-anyone",
        "gpu_mode": os.getenv("OUTFIT_GPU_MODE", "composite"),
        "cache_size": len(CACHE),
    }


@app.post("/predict", response_model=PredictResponse)
async def predict(payload: PredictRequest) -> PredictResponse:
    key = cache_key(payload)
    if key in CACHE:
        return PredictResponse(
            ok=True,
            mode="composite",
            result_image_url=CACHE[key],
            job_id=key[:16],
            cached=True,
        )

    gpu_mode = os.getenv("OUTFIT_GPU_MODE", "composite")

    # Production path: mount OutfitAnyone weights and run inference when GPU_MODE=outfit-anyone
    if gpu_mode == "outfit-anyone" and os.getenv("OUTFITANYONE_MODEL_PATH"):
        # Placeholder hook for GPU inference integration
        result_url = str(payload.top_garment_url)
        mode: Literal["outfit-anyone", "composite", "fallback"] = "outfit-anyone"
    else:
        # Composite fallback: prefer garment image (validated reachable)
        result_url = str(payload.top_garment_url)
        mode = "composite"
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.head(result_url)
                if response.status_code >= 400:
                    result_url = AVATAR_PRESETS[payload.gender]
                    mode = "fallback"
        except httpx.HTTPError:
            result_url = AVATAR_PRESETS[payload.gender]
            mode = "fallback"

    CACHE[key] = result_url

    return PredictResponse(
        ok=True,
        mode=mode,
        result_image_url=result_url,
        job_id=key[:16],
        cached=False,
    )

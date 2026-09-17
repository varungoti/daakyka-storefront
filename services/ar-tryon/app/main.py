from __future__ import annotations

import hashlib
import os
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, HttpUrl

from app.compositor import (
    ImageTooLargeError,
    UntrustedImageHostError,
    compose_tryon_from_urls,
    warmup_pose_model,
)

CACHE: dict[str, str] = {}
MAX_CACHE_ENTRIES = 128


@asynccontextmanager
async def lifespan(_: FastAPI):
    warmup_pose_model()
    yield


app = FastAPI(
    title="DAAKYKA AR Try-On Service",
    version="1.0.0",
    description="MediaPipe + OpenCV pose-based virtual try-on (CPU, no GPU).",
    lifespan=lifespan,
)


def require_api_key(authorization: str | None = Header(default=None)) -> None:
    """Optional bearer auth: enforced only when AR_TRYON_API_KEY is set,
    so local `docker compose up -d ar-tryon` keeps working unauthenticated
    behind a private network. Set it before exposing this service
    publicly (e.g. a Railway deployment)."""
    expected = os.environ.get("AR_TRYON_API_KEY")
    if not expected:
        return
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Unauthorized")
    if authorization.removeprefix("Bearer ") != expected:
        raise HTTPException(status_code=401, detail="Unauthorized")


AVATAR_PRESETS = {
    "male": "https://images.pexels.com/photos/5327656/pexels-photo-5327656.jpeg?auto=compress&cs=tinysrgb&w=800",
    "female": "https://images.pexels.com/photos/4173251/pexels-photo-4173251.jpeg?auto=compress&cs=tinysrgb&w=800",
}


class PredictRequest(BaseModel):
    gender: Literal["male", "female"] = "female"
    top_garment_url: HttpUrl
    bottom_garment_url: HttpUrl | None = None
    avatar_url: HttpUrl | None = None
    top_handle: str | None = None
    bottom_handle: str | None = None
    color: str | None = None


class PredictResponse(BaseModel):
    ok: bool
    mode: Literal["ar-tryon", "fallback"]
    result_image_url: str
    job_id: str
    cached: bool = False
    pose_detected: bool = True


def cache_key(payload: PredictRequest) -> str:
    raw = "|".join(
        [
            payload.gender,
            str(payload.avatar_url or ""),
            str(payload.top_garment_url),
            str(payload.bottom_garment_url or ""),
            payload.color or "",
        ]
    )
    return hashlib.sha256(raw.encode()).hexdigest()


@app.get("/health")
async def health() -> dict[str, object]:
    return {
        "ok": True,
        "service": "ar-tryon",
        "engine": "mediapipe-opencv",
        "cache_size": len(CACHE),
    }


@app.post("/predict", response_model=PredictResponse, dependencies=[Depends(require_api_key)])
async def predict(payload: PredictRequest) -> PredictResponse:
    key = cache_key(payload)
    if key in CACHE:
        return PredictResponse(
            ok=True,
            mode="ar-tryon",
            result_image_url=CACHE[key],
            job_id=key[:16],
            cached=True,
            pose_detected=True,
        )

    avatar_url = str(payload.avatar_url or AVATAR_PRESETS[payload.gender])

    try:
        result_data_url = compose_tryon_from_urls(
            avatar_url=avatar_url,
            top_garment_url=str(payload.top_garment_url),
            bottom_garment_url=str(payload.bottom_garment_url) if payload.bottom_garment_url else None,
        )
    except (UntrustedImageHostError, ImageTooLargeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    # Bound the in-memory cache — it has no eviction otherwise and this
    # process never restarts on its own.
    if len(CACHE) >= MAX_CACHE_ENTRIES:
        CACHE.pop(next(iter(CACHE)))
    CACHE[key] = result_data_url

    return PredictResponse(
        ok=True,
        mode="ar-tryon",
        result_image_url=result_data_url,
        job_id=key[:16],
        cached=False,
        pose_detected=True,
    )

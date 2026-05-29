"""MediaPipe pose-based garment overlay — inspired by OpenCV AR try-on patterns."""

from __future__ import annotations

import base64
import io
from dataclasses import dataclass

import cv2
import httpx
import mediapipe as mp
import numpy as np
from PIL import Image

_POSE: mp.solutions.pose.Pose | None = None


def get_pose_detector() -> mp.solutions.pose.Pose:
    global _POSE
    if _POSE is None:
        _POSE = mp.solutions.pose.Pose(
            static_image_mode=True,
            model_complexity=1,
            min_detection_confidence=0.5,
        )
    return _POSE


def warmup_pose_model() -> None:
    """Load MediaPipe weights once at process start to avoid first-request latency."""
    blank = np.zeros((256, 192, 3), dtype=np.uint8)
    detect_torso(blank)


@dataclass
class TorsoBounds:
    left_shoulder: tuple[int, int]
    right_shoulder: tuple[int, int]
    left_hip: tuple[int, int]
    right_hip: tuple[int, int]

    @property
    def shoulders_center(self) -> tuple[int, int]:
        return (
            (self.left_shoulder[0] + self.right_shoulder[0]) // 2,
            (self.left_shoulder[1] + self.right_shoulder[1]) // 2,
        )

    @property
    def hips_center(self) -> tuple[int, int]:
        return (
            (self.left_hip[0] + self.right_hip[0]) // 2,
            (self.left_hip[1] + self.right_hip[1]) // 2,
        )

    @property
    def shoulder_width(self) -> float:
        return float(np.linalg.norm(np.array(self.left_shoulder) - np.array(self.right_shoulder)))

    @property
    def torso_height(self) -> float:
        return float(np.linalg.norm(np.array(self.shoulders_center) - np.array(self.hips_center)))


def fetch_image_bgr(url: str, timeout: float = 15.0) -> np.ndarray:
    with httpx.Client(timeout=timeout, follow_redirects=True) as client:
        response = client.get(url)
        response.raise_for_status()
        data = np.frombuffer(response.content, dtype=np.uint8)
        image = cv2.imdecode(data, cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError(f"Could not decode image from {url}")
        return image


def detect_torso(frame_bgr: np.ndarray) -> TorsoBounds | None:
    h, w, _ = frame_bgr.shape
    rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
    pose = get_pose_detector()
    results = pose.process(rgb)

    if not results.pose_landmarks:
        return None

    lm = results.pose_landmarks.landmark

    def point(index: int) -> tuple[int, int]:
        return int(lm[index].x * w), int(lm[index].y * h)

    # Mediapipe pose indices: shoulders 11/12, hips 23/24
    return TorsoBounds(
        left_shoulder=point(11),
        right_shoulder=point(12),
        left_hip=point(23),
        right_hip=point(24),
    )


def pil_from_bgr(frame_bgr: np.ndarray) -> Image.Image:
    rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
    return Image.fromarray(rgb)


def bgr_from_pil(image: Image.Image) -> np.ndarray:
    return cv2.cvtColor(np.array(image.convert("RGB")), cv2.COLOR_RGB2BGR)


def overlay_rgba_on_bgr(bg_bgr: np.ndarray, overlay_rgba: Image.Image, x: int, y: int) -> np.ndarray:
    bg_pil = pil_from_bgr(bg_bgr)
    bg_pil.paste(overlay_rgba, (int(x), int(y)), overlay_rgba)
    return bgr_from_pil(bg_pil)


def garment_to_rgba(garment_bgr: np.ndarray, opacity: float = 0.92) -> Image.Image:
    """Convert product photo to RGBA with soft edges for torso overlay."""
    garment_rgb = cv2.cvtColor(garment_bgr, cv2.COLOR_BGR2RGB)
    pil = Image.fromarray(garment_rgb).convert("RGBA")

    alpha = Image.new("L", pil.size, int(255 * opacity))
    pil.putalpha(alpha)
    return pil


def resize_garment(garment_rgba: Image.Image, target_width: int) -> Image.Image:
    aspect = garment_rgba.width / max(garment_rgba.height, 1)
    new_w = max(1, target_width)
    new_h = max(1, int(new_w / aspect))
    return garment_rgba.resize((new_w, new_h), Image.Resampling.LANCZOS)


def overlay_torso_garment(
    frame_bgr: np.ndarray,
    garment_bgr: np.ndarray,
    torso: TorsoBounds,
    *,
    region: str = "top",
) -> np.ndarray:
    garment_rgba = garment_to_rgba(garment_bgr)

    if region == "top":
        target_w = int(torso.shoulder_width * 1.35)
        target_h = int(torso.torso_height * 1.15)
        resized = resize_garment(garment_rgba, target_w)
        if resized.height > target_h:
            ratio = target_h / resized.height
            resized = resized.resize((max(1, int(resized.width * ratio)), target_h), Image.Resampling.LANCZOS)

        cx, cy = torso.shoulders_center
        x = int(cx - resized.width / 2)
        y = int(cy - resized.height * 0.22)
    else:
        target_w = int(torso.shoulder_width * 1.2)
        target_h = int(torso.torso_height * 1.05)
        resized = resize_garment(garment_rgba, target_w)
        if resized.height > target_h:
            ratio = target_h / resized.height
            resized = resized.resize((max(1, int(resized.width * ratio)), target_h), Image.Resampling.LANCZOS)

        cx, _ = torso.hips_center
        x = int(cx - resized.width / 2)
        y = int(torso.hips_center[1] - resized.height * 0.15)

    return overlay_rgba_on_bgr(frame_bgr, resized, x, y)


def center_fallback_overlay(frame_bgr: np.ndarray, garment_bgr: np.ndarray, scale: float = 0.55) -> np.ndarray:
    """Fallback when pose landmarks are not detected."""
    h, w, _ = frame_bgr.shape
    garment_rgba = garment_to_rgba(garment_bgr, opacity=0.88)
    target_w = int(w * scale)
    resized = resize_garment(garment_rgba, target_w)
    x = (w - resized.width) // 2
    y = int(h * 0.18)
    return overlay_rgba_on_bgr(frame_bgr, resized, x, y)


def compose_tryon(
    avatar_bgr: np.ndarray,
    top_garment_bgr: np.ndarray,
    bottom_garment_bgr: np.ndarray | None = None,
) -> bytes:
    frame = avatar_bgr.copy()
    torso = detect_torso(frame)

    if torso:
        frame = overlay_torso_garment(frame, top_garment_bgr, torso, region="top")
        if bottom_garment_bgr is not None:
            frame = overlay_torso_garment(frame, bottom_garment_bgr, torso, region="bottom")
    else:
        frame = center_fallback_overlay(frame, top_garment_bgr)
        if bottom_garment_bgr is not None:
            frame = center_fallback_overlay(frame, bottom_garment_bgr, scale=0.45)

    success, encoded = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
    if not success:
        raise ValueError("Failed to encode try-on result")
    return encoded.tobytes()


def compose_tryon_from_urls(
    avatar_url: str,
    top_garment_url: str,
    bottom_garment_url: str | None = None,
) -> str:
    avatar = fetch_image_bgr(avatar_url)
    top = fetch_image_bgr(top_garment_url)
    bottom = fetch_image_bgr(bottom_garment_url) if bottom_garment_url else None
    jpeg_bytes = compose_tryon(avatar, top, bottom)
    encoded = base64.b64encode(jpeg_bytes).decode("ascii")
    return f"data:image/jpeg;base64,{encoded}"

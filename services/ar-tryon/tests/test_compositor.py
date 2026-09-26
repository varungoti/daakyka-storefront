"""Image-safety tests for the AR try-on compositor (F-305).

Run from services/ar-tryon:
    pip install -r requirements-dev.txt
    python -m pytest tests/ -v
"""
from __future__ import annotations

import io

import pytest
from PIL import Image

from app.compositor import (
    ALLOWED_IMAGE_HOSTS,
    ImageTooLargeError,
    UntrustedImageHostError,
    check_image_pixel_count,
    validate_image_url,
)


def test_daakyka_host_no_longer_allowlisted() -> None:
    """daakyka.com was dropped from src/lib/security/image-hosts.ts's
    TRUSTED_IMAGE_HOSTS on 2026-09-20 (unreachable domain); this
    service's allowlist must stay in sync."""
    assert "daakyka.com" not in ALLOWED_IMAGE_HOSTS


def test_validate_image_url_rejects_untrusted_host_without_echoing_url() -> None:
    with pytest.raises(UntrustedImageHostError) as exc_info:
        validate_image_url("https://evil.example.com/x.jpg?token=secret")
    assert "evil.example.com" not in str(exc_info.value)
    assert "secret" not in str(exc_info.value)


def test_check_image_pixel_count_rejects_oversized_image() -> None:
    """A small, highly-compressible PNG that decodes to well above the
    pixel cap must be rejected before cv2.imdecode ever allocates the
    full buffer."""
    huge = Image.new("L", (10_000, 10_000), color=0)  # 100 MP
    buf = io.BytesIO()
    huge.save(buf, format="PNG", optimize=True)
    assert len(buf.getvalue()) < 200_000  # tiny on the wire, huge decoded

    with pytest.raises(ImageTooLargeError):
        check_image_pixel_count(buf.getvalue())


def test_check_image_pixel_count_allows_normal_image() -> None:
    small = Image.new("RGB", (400, 600), color=(10, 20, 30))
    buf = io.BytesIO()
    small.save(buf, format="JPEG")

    check_image_pixel_count(buf.getvalue())  # must not raise

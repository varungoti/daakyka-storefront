"""Auth-hardening tests for the AR try-on service (F-305).

Run from services/ar-tryon:
    pip install -r requirements-dev.txt
    python -m pytest tests/ -v
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def _clean_auth_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AR_TRYON_API_KEY", raising=False)
    monkeypatch.delenv("AR_TRYON_ALLOW_UNAUTH", raising=False)


def test_predict_rejects_unauthenticated_request_with_no_key_configured() -> None:
    """Auth used to be a no-op whenever AR_TRYON_API_KEY was unset, so a
    deployment that forgot to set the key was silently wide open. It must
    now fail closed by default."""
    response = client.post(
        "/predict",
        json={"top_garment_url": "https://images.pexels.com/photo.jpg"},
    )
    assert response.status_code == 401


def test_health_allows_unauthenticated_request_with_explicit_local_opt_out(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The explicit, local-only escape hatch still works."""
    monkeypatch.setenv("AR_TRYON_ALLOW_UNAUTH", "1")
    response = client.get("/health")
    assert response.status_code == 200


def test_predict_rejects_wrong_bearer_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AR_TRYON_API_KEY", "correct-key")
    response = client.post(
        "/predict",
        json={"top_garment_url": "https://images.pexels.com/photo.jpg"},
        headers={"Authorization": "Bearer wrong-key"},
    )
    assert response.status_code == 401


def test_predict_rejects_missing_authorization_header_when_key_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AR_TRYON_API_KEY", "correct-key")
    response = client.post(
        "/predict",
        json={"top_garment_url": "https://images.pexels.com/photo.jpg"},
    )
    assert response.status_code == 401


def test_predict_with_correct_key_reaches_next_check_without_leaking_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Confirms a correct key passes auth (falls through to the untrusted
    -host check instead of always 401ing), and that the resulting error
    never echoes the rejected URL back to the caller."""
    monkeypatch.setenv("AR_TRYON_API_KEY", "correct-key")
    response = client.post(
        "/predict",
        json={"top_garment_url": "https://evil.example.com/photo.jpg"},
        headers={"Authorization": "Bearer correct-key"},
    )
    assert response.status_code == 400
    assert "evil.example.com" not in response.text

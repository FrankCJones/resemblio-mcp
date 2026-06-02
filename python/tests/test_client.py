"""Unit tests for :class:`resemblio_mcp.client.ResemblioClient`.

Network is replaced by an httpx MockTransport so the suite runs offline.
Verifies the Bearer header, the 4xx-no-retry posture, the 5xx-retry
posture, the Idempotency-Key forwarding, and query-param serialization.
"""
from __future__ import annotations

import json

import httpx
import pytest

from resemblio_mcp.client import (
    ExtractionCreateRequest,
    ResemblioApiError,
    ResemblioClient,
)


def _make_client(handler, *, max_retries: int = 3, backoff_s: float = 0.0) -> ResemblioClient:
    """Build a client wired to a MockTransport handler."""
    transport = httpx.MockTransport(handler)
    return ResemblioClient(
        api_key="rsmb_test_xyz",
        base_url="https://api.resemblio.test",
        max_retries=max_retries,
        backoff_s=backoff_s,
        transport=transport,
    )


def test_constructor_rejects_empty_api_key():
    """Empty api_key is a programming error and must raise at construction."""
    with pytest.raises(ValueError, match="api_key is required"):
        ResemblioClient(api_key="")


@pytest.mark.asyncio
async def test_bearer_header_attached():
    """Every request must carry Authorization: Bearer <api_key>."""
    captured: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["auth"] = request.headers.get("authorization", "")
        return httpx.Response(200, json={"items": [], "schema_version": 2})

    client = _make_client(handler)
    await client.list_extractions()
    assert captured["auth"] == "Bearer rsmb_test_xyz"


@pytest.mark.asyncio
async def test_4xx_surfaces_as_api_error_without_retry():
    """402 (insufficient credit) must not retry; one call only."""
    calls = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["count"] += 1
        return httpx.Response(402, json={"error": "insufficient_credit"})

    client = _make_client(handler, max_retries=3)
    with pytest.raises(ResemblioApiError) as info:
        await client.create_extraction(ExtractionCreateRequest(url="https://example.com"))
    assert info.value.status == 402
    assert calls["count"] == 1


@pytest.mark.asyncio
async def test_5xx_retries_up_to_max():
    """503 retries `max_retries` times before raising the last error."""
    calls = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["count"] += 1
        return httpx.Response(503, json={"error": "unavailable"})

    client = _make_client(handler, max_retries=2)
    with pytest.raises(ResemblioApiError):
        await client.list_extractions()
    assert calls["count"] == 3  # initial + 2 retries


@pytest.mark.asyncio
async def test_idempotency_key_forwarded():
    """The Idempotency-Key header must reach the API verbatim."""
    captured: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["idem"] = request.headers.get("idempotency-key", "")
        return httpx.Response(
            200,
            json={
                "id": 1,
                "status": "ok",
                "tokens": None,
                "dtcg": None,
                "download_url": None,
                "schema_version": 2,
                "tokens_url": None,
                "manifest": None,
            },
        )

    client = _make_client(handler)
    await client.create_extraction(
        ExtractionCreateRequest(url="https://example.com"),
        idempotency_key="idem-123",
    )
    assert captured["idem"] == "idem-123"


@pytest.mark.asyncio
async def test_list_query_params_serialized():
    """limit + before must appear as querystring values on the list endpoint."""
    captured: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        return httpx.Response(200, json={"items": [], "schema_version": 2})

    client = _make_client(handler)
    await client.list_extractions(limit=10, before=42)
    assert "limit=10" in captured["url"]
    assert "before=42" in captured["url"]


@pytest.mark.asyncio
async def test_create_extraction_returns_typed_response():
    """A 200 response is parsed into the ExtractionResponse pydantic model."""
    payload = {
        "id": 99,
        "status": "ok",
        "tokens": {"palette": {"red": "#f00"}},
        "dtcg": {"color": {}},
        "download_url": "https://example.com/x.zip",
        "schema_version": 2,
        "tokens_url": "https://example.com/tokens.json",
        "manifest": {
            "id": 99,
            "status": "ok",
            "source_url": "https://example.com",
            "created_at_utc": "2026-06-02T00:00:00Z",
            "schema_version": 2,
            "quality_score": 0.9,
            "tokens_url": "https://example.com/tokens.json",
            "download_url": "https://example.com/x.zip",
        },
    }

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=payload)

    client = _make_client(handler)
    response = await client.create_extraction(ExtractionCreateRequest(url="https://example.com"))
    assert response.id == 99
    assert response.manifest is not None
    assert response.manifest.tokens_url == "https://example.com/tokens.json"
    # Ensure JSON round-trips cleanly through pydantic.
    assert json.loads(response.model_dump_json())["schema_version"] == 2

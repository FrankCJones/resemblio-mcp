"""Tests for the Phase 2 canonical Apple MCP consumer."""
from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest

from resemblio_mcp.client import ResemblioApiError, ResemblioClient
from resemblio_mcp.tools import run_get_library_manifest

KNOWN_ARTIFACT_SHA256 = "789cb9743f6b84ff5274ad915b6fc89cf5e76d4ec0d8bc52db30b3a07d95b547"


def canonical_artifact() -> dict[str, object]:
    """Load the integrity-pinned API artifact vendored for consumer tests."""
    path = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "apple-system-manifest.json"
    return json.loads(path.read_text(encoding="utf-8"))


def make_client(handler, *, max_retries: int = 0) -> ResemblioClient:
    """Build an offline client using the supplied HTTP transport handler."""
    return ResemblioClient(
        api_key="rsmb_test",
        base_url="https://api.resemblio.test",
        max_retries=max_retries,
        backoff_s=0,
        transport=httpx.MockTransport(handler),
    )


@pytest.mark.asyncio
async def test_manifest_endpoint_returns_api_artifact_unchanged():
    """The MCP client unwraps only the API envelope and preserves the artifact."""
    artifact = canonical_artifact()

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/library/manifests/apple"
        return httpx.Response(200, json={"schema_version": 2, "data": artifact})

    result = await make_client(handler).get_apple_system_manifest()
    assert result == artifact
    assert result["artifact_sha256"] == KNOWN_ARTIFACT_SHA256


@pytest.mark.asyncio
async def test_manifest_rejects_bad_artifact_schema():
    """A mismatched artifact schema cannot pass through the MCP boundary."""
    artifact = {**canonical_artifact(), "schema_version": "wrong"}
    client = make_client(lambda request: httpx.Response(200, json={"schema_version": 2, "data": artifact}))
    with pytest.raises(ValueError, match="unsupported schema_version"):
        await client.get_apple_system_manifest()


@pytest.mark.asyncio
async def test_manifest_rejects_digest_mismatch():
    """Tampering with the content address must stop delivery to MCP."""
    artifact = {**canonical_artifact(), "artifact_sha256": "0" * 64}
    client = make_client(lambda request: httpx.Response(200, json={"schema_version": 2, "data": artifact}))
    with pytest.raises(ValueError, match="does not match"):
        await client.get_apple_system_manifest()


@pytest.mark.asyncio
async def test_manifest_endpoint_error_surfaces_api_error():
    """Read endpoint failures preserve the normal structured API error path."""
    client = make_client(lambda request: httpx.Response(503, json={"error": "unavailable"}))
    with pytest.raises(ResemblioApiError) as error:
        await client.get_apple_system_manifest()
    assert error.value.status == 503


@pytest.mark.asyncio
async def test_manifest_tool_returns_client_artifact_by_identity():
    """The tool adds no response wrapper or field transformation."""
    artifact = canonical_artifact()

    class StubClient:
        async def get_apple_system_manifest(self) -> dict[str, object]:
            return artifact

    result = await run_get_library_manifest(StubClient())  # type: ignore[arg-type]
    assert result is artifact

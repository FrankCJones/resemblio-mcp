"""Tests exact DTCG transport through the Python MCP server."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import anyio
import httpx
import pytest
from mcp import ClientSession
from mcp.shared.memory import create_client_server_memory_streams

from resemblio_mcp.client import (
    APPLE_LIBRARY_EXPORT_MEDIA_TYPE,
    APPLE_LIBRARY_EXPORT_PATH,
    ResemblioApiError,
    ResemblioClient,
    validate_design_tokens_bytes,
)
from resemblio_mcp.server import build_server
from resemblio_mcp.tools import (
    GET_LIBRARY_EXPORT_INPUT_SCHEMA,
    run_get_library_export,
    validate_library_export_input,
)

FIXTURES = Path(__file__).resolve().parents[2] / "tests" / "fixtures"


def fixture_bytes() -> bytes:
    """Load the shared exact-byte DTCG fixture."""
    return (FIXTURES / "design.tokens.json").read_bytes()


def make_client(handler, *, max_retries: int = 0) -> ResemblioClient:
    """Build an offline API client with deterministic retry timing."""
    return ResemblioClient(
        api_key="rsmb_test",
        base_url="https://api.resemblio.test",
        max_retries=max_retries,
        backoff_s=0,
        transport=httpx.MockTransport(handler),
    )


async def call_protocol(client: ResemblioClient, arguments: dict[str, Any]):
    """Call the registered tool through an in-memory MCP session."""
    server = build_server(client)
    async with create_client_server_memory_streams() as (client_streams, server_streams):
        async with ClientSession(*client_streams) as session:
            async with anyio.create_task_group() as task_group:
                task_group.start_soon(server.run, *server_streams, server.create_initialization_options())
                await session.initialize()
                result = await session.call_tool("resemblio_get_library_export", arguments)
                task_group.cancel_scope.cancel()
                return result


def test_no_input_schema_is_shared_and_enforced():
    """Both packages expose one deterministic action with no selectors."""
    expected = json.loads((FIXTURES / "library-export-input-schema.json").read_text(encoding="utf-8"))
    assert GET_LIBRARY_EXPORT_INPUT_SCHEMA == expected
    assert validate_library_export_input({}) == {}
    with pytest.raises(ValueError, match="does not accept arguments"):
        validate_library_export_input({"selection": "complete"})


@pytest.mark.asyncio
async def test_exact_utf8_body_is_preserved_without_query_or_reserialization():
    """The client returns the exact terminal-line-feed and non-ASCII bytes."""
    body = fixture_bytes()

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == APPLE_LIBRARY_EXPORT_PATH
        assert request.url.query == b""
        assert request.headers["accept"] == APPLE_LIBRARY_EXPORT_MEDIA_TYPE
        return httpx.Response(200, content=body, headers={"content-type": APPLE_LIBRARY_EXPORT_MEDIA_TYPE})

    result = await run_get_library_export(make_client(handler), {})
    assert result.encode("utf-8") == body
    assert result.endswith("\n")
    assert "Café Sans" in result


@pytest.mark.asyncio
async def test_protocol_returns_one_exact_text_block():
    """The server adds no envelope or structured content around the JSON."""
    body = fixture_bytes()

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=body, headers={"content-type": APPLE_LIBRARY_EXPORT_MEDIA_TYPE})

    result = await call_protocol(make_client(handler), {})
    assert result.is_error is not True
    assert len(result.content) == 1
    assert result.content[0].type == "text"
    assert result.content[0].text.encode("utf-8") == body
    assert result.structured_content is None


def test_malformed_utf8_and_non_dtcg_json_fail_closed():
    """Transport validation rejects bytes that cannot be the product."""
    with pytest.raises(ValueError, match="UTF-8"):
        validate_design_tokens_bytes(b"\xc3(")
    with pytest.raises(ValueError, match="pure DTCG root"):
        validate_design_tokens_bytes(b'{"tokens":{}}\n')


@pytest.mark.asyncio
async def test_wrong_media_type_fails_closed():
    """A JSON error envelope cannot be mistaken for design tokens."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=fixture_bytes(), headers={"content-type": "application/json"})

    with pytest.raises(ValueError, match="content type"):
        await make_client(handler).get_apple_library_export()


@pytest.mark.asyncio
async def test_4xx_is_not_retried_and_5xx_is_retried():
    """Exact transport retains the existing HTTP retry boundary."""
    client_calls = {"count": 0}

    def client_error(request: httpx.Request) -> httpx.Response:
        client_calls["count"] += 1
        return httpx.Response(403, json={"error": "entitlement_required"})

    with pytest.raises(ResemblioApiError):
        await make_client(client_error, max_retries=3).get_apple_library_export()
    assert client_calls["count"] == 1

    transient_calls = {"count": 0}

    def transient(request: httpx.Request) -> httpx.Response:
        transient_calls["count"] += 1
        return httpx.Response(503, json={"error": "unavailable"})

    with pytest.raises(ResemblioApiError):
        await make_client(transient, max_retries=2).get_apple_library_export()
    assert transient_calls["count"] == 3

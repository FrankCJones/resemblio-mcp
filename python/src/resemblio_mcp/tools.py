"""MCP tool handlers for the Resemblio MCP server.

Two tools:

* ``resemblio_extract`` - wraps ``POST /v1/extractions``. Synchronous
  from the caller's perspective.
* ``resemblio_list_extractions`` - wraps ``GET /v1/extractions``.

Contract mirrored verbatim from the TypeScript package so both server
implementations advertise the same shape to MCP clients.
"""
from __future__ import annotations

from typing import Any, TypedDict

from resemblio_mcp.client import (
    ExtractionCreateRequest,
    ExtractionListResponse,
    ExtractionResponse,
    ResemblioClient,
)

EXTRACT_TOOL_NAME = "resemblio_extract"
LIST_TOOL_NAME = "resemblio_list_extractions"

EXTRACT_INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "url": {
            "type": "string",
            "description": "The URL to extract a design system from. Must be a publicly reachable HTTP(S) page.",
        },
        "private": {
            "type": "boolean",
            "description": (
                "If true, run as a private extraction ($10) - results not surfaced in the public corpus. "
                "Default false ($5 public)."
            ),
            "default": False,
        },
        "idempotency_key": {
            "type": "string",
            "description": (
                "Optional client-supplied key to make this call idempotent within the API TTL window. "
                "A retry with the same key + same body replays the original response without re-charging."
            ),
        },
    },
    "required": ["url"],
    "additionalProperties": False,
}

LIST_INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": 100,
            "default": 20,
            "description": "Page size; bounded server-side to [1, 100].",
        },
        "before": {
            "type": "integer",
            "description": "Cursor: return rows with id strictly less than this value (newest-first paging).",
        },
    },
    "additionalProperties": False,
}


class ExtractSummary(TypedDict):
    """Compact summary returned alongside the full extraction response."""

    palette_color_count: int
    font_count: int
    has_dtcg: bool
    has_zip: bool


class ExtractToolOutput(TypedDict):
    """Final tool output for ``resemblio_extract``."""

    extraction_id: int
    status: str
    manifest_url: str | None
    download_url: str | None
    summary: ExtractSummary
    schema_version: int
    response: dict[str, Any]


class ListToolOutput(TypedDict):
    """Final tool output for ``resemblio_list_extractions``."""

    items: list[dict[str, Any]]
    schema_version: int
    total: int


def _count_entries(value: Any) -> int:
    """Return len(value) for dicts/lists, 0 otherwise. Pure helper for :func:`summarize`."""
    if value is None:
        return 0
    if isinstance(value, dict):
        return len(value)
    if isinstance(value, list):
        return len(value)
    return 0


def summarize(response: ExtractionResponse) -> ExtractSummary:
    """Build the compact summary block from a successful ExtractionResponse.

    Pure function; unit-testable without network. Reads ``palette`` or
    ``colors`` and ``fonts`` or ``typography`` off the inline tokens
    payload (the canonical keys vary across DTCG profiles).
    """
    tokens = response.tokens or {}
    palette = tokens.get("palette", tokens.get("colors"))
    fonts = tokens.get("fonts", tokens.get("typography"))
    return ExtractSummary(
        palette_color_count=_count_entries(palette),
        font_count=_count_entries(fonts),
        has_dtcg=response.dtcg is not None,
        has_zip=response.download_url is not None,
    )


def shape_list_response(envelope: ExtractionListResponse) -> ListToolOutput:
    """Pure reshape from API envelope to MCP tool output."""
    return ListToolOutput(
        items=[item.model_dump() for item in envelope.items],
        schema_version=envelope.schema_version,
        total=len(envelope.items),
    )


async def run_extract(client: ResemblioClient, args: dict[str, Any]) -> ExtractToolOutput:
    """Tool handler for ``resemblio_extract``.

    Calls the API client and reshapes the response into the MCP tool
    contract. Errors propagate; the server-level handler turns them
    into the MCP error envelope.
    """
    request = ExtractionCreateRequest(
        url=args["url"],
        private=bool(args.get("private", False)),
    )
    response = await client.create_extraction(
        request,
        idempotency_key=args.get("idempotency_key"),
    )
    manifest_url: str | None = None
    if response.manifest is not None:
        manifest_url = response.manifest.tokens_url
    if manifest_url is None:
        manifest_url = response.tokens_url
    return ExtractToolOutput(
        extraction_id=response.id,
        status=response.status,
        manifest_url=manifest_url,
        download_url=response.download_url,
        summary=summarize(response),
        schema_version=response.schema_version,
        response=response.model_dump(mode="json"),
    )


async def run_list_extractions(client: ResemblioClient, args: dict[str, Any]) -> ListToolOutput:
    """Tool handler for ``resemblio_list_extractions``."""
    envelope = await client.list_extractions(
        limit=args.get("limit"),
        before=args.get("before"),
    )
    return shape_list_response(envelope)

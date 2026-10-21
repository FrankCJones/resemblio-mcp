"""Resemblio MCP server (Python) stdio entrypoint.

Advertises four tools (``resemblio_extract``, ``resemblio_list_extractions``, ``resemblio_get_library_manifest``, ``resemblio_get_library_export``)
over stdio per the MCP spec. Auth is provided at process start via the
``RESEMBLIO_API_KEY`` environment variable or the ``--api-key <value>``
command-line flag.

Configuration:

* ``RESEMBLIO_API_KEY`` (required unless ``--api-key`` is passed)
* ``RESEMBLIO_BASE_URL`` (optional; defaults to ``https://api.resemblio.com``)

Run::

    resemblio-mcp                    # uses env vars
    resemblio-mcp --api-key rsmb_... # explicit
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from resemblio_mcp.client import ResemblioApiError, ResemblioClient
from resemblio_mcp.tools import (
    EXTRACT_INPUT_SCHEMA,
    EXTRACT_TOOL_NAME,
    GET_LIBRARY_EXPORT_INPUT_SCHEMA,
    GET_LIBRARY_EXPORT_TOOL_NAME,
    GET_LIBRARY_MANIFEST_INPUT_SCHEMA,
    GET_LIBRARY_MANIFEST_TOOL_NAME,
    LIST_INPUT_SCHEMA,
    LIST_TOOL_NAME,
    run_extract,
    run_get_library_export,
    run_get_library_manifest,
    run_list_extractions,
)

logger = logging.getLogger("resemblio_mcp")


@dataclass(frozen=True)
class ServerConfig:
    """Resolved runtime configuration."""

    api_key: str
    base_url: str | None


def parse_args(argv: Sequence[str]) -> dict[str, str]:
    """Parse ``--api-key`` and ``--base-url`` from argv.

    Returns a dict carrying only the flags that were set. The dict is
    merged onto the env vars by :func:`resolve_config`; CLI wins.
    """
    out: dict[str, str] = {}
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg == "--api-key" and i + 1 < len(argv):
            out["api_key"] = argv[i + 1]
            i += 2
            continue
        if arg == "--base-url" and i + 1 < len(argv):
            out["base_url"] = argv[i + 1]
            i += 2
            continue
        i += 1
    return out


def resolve_config(argv: Sequence[str], env: dict[str, str]) -> ServerConfig:
    """Resolve runtime configuration from argv + env.

    CLI flags win over env vars for the same field. Raises
    :class:`RuntimeError` when no API key is supplied anywhere.
    """
    parsed = parse_args(argv)
    api_key = parsed.get("api_key") or env.get("RESEMBLIO_API_KEY", "")
    base_url = parsed.get("base_url") or env.get("RESEMBLIO_BASE_URL")
    if not api_key.strip():
        raise RuntimeError(
            "Resemblio MCP: no API key found. "
            "Set RESEMBLIO_API_KEY or pass --api-key <key>."
        )
    return ServerConfig(api_key=api_key.strip(), base_url=base_url)


def _to_text_content(payload: Any) -> list[dict[str, Any]]:
    """Format a tool result payload as MCP ``text`` content blocks."""
    return [{"type": "text", "text": json.dumps(payload, indent=2, default=str)}]


async def _serve(client: ResemblioClient) -> None:
    """Wire all tool handlers to an MCP stdio server.

    Imports the SDK lazily so test environments without the ``mcp``
    package installed can still import this module to exercise
    :func:`parse_args` / :func:`resolve_config`.
    """
    from mcp.server.stdio import stdio_server  # type: ignore[import-not-found]

    server = build_server(client)

    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


def build_server(client: ResemblioClient):
    """Build the registered MCP server used by stdio and protocol tests.

    The SDK import remains lazy so configuration tests can import this module
    even when the optional runtime dependency has not been installed.
    """
    from mcp.server import Server  # type: ignore[import-not-found]
    from mcp.types import (  # type: ignore[import-not-found]
        CallToolRequestParams,
        CallToolResult,
        ListToolsResult,
        PaginatedRequestParams,
        TextContent,
        Tool,
    )

    async def _list_tools(
        _context: Any,
        _params: PaginatedRequestParams | None,
    ) -> ListToolsResult:
        return ListToolsResult(tools=[
            Tool(
                name=EXTRACT_TOOL_NAME,
                description=(
                    "Extract a trademark-stripped, brand-faithful, code-bearing design "
                    "system from a URL. Inspirado, no copiado. Returns DTCG tokens, a "
                    "signed manifest URL, and a ZIP download URL. Charges the configured "
                    "Resemblio account ($5 public / $10 private)."
                ),
                inputSchema=EXTRACT_INPUT_SCHEMA,
            ),
            Tool(
                name=LIST_TOOL_NAME,
                description=(
                    "List the calling Resemblio account's extraction history, newest first. "
                    "Paginated via `before` cursor."
                ),
                inputSchema=LIST_INPUT_SCHEMA,
            ),
            Tool(
                name=GET_LIBRARY_MANIFEST_TOOL_NAME,
                description=(
                    "Retrieve the verified canonical Apple library manifest. This read-only "
                    "tool is free and returns the API artifact unchanged, including its "
                    "record set, facets, version, and SHA-256 digest."
                ),
                inputSchema=GET_LIBRARY_MANIFEST_INPUT_SCHEMA,
            ),
            Tool(
                name=GET_LIBRARY_EXPORT_TOOL_NAME,
                description=(
                    "Retrieve the canonical Apple design.tokens.json document as pure DTCG JSON. "
                    "This read-only tool returns the exact API body. "
                    "Requires an entitled Resemblio API key."
                ),
                inputSchema=GET_LIBRARY_EXPORT_INPUT_SCHEMA,
            ),
        ])

    async def _call_tool(
        _context: Any,
        params: CallToolRequestParams,
    ) -> CallToolResult:
        name = params.name
        arguments = params.arguments or {}
        try:
            if name == EXTRACT_TOOL_NAME:
                result = await run_extract(client, arguments or {})
                return CallToolResult(
                    content=[TextContent(type="text", text=json.dumps(result, indent=2, default=str))]
                )
            if name == LIST_TOOL_NAME:
                result = await run_list_extractions(client, arguments or {})
                return CallToolResult(
                    content=[TextContent(type="text", text=json.dumps(result, indent=2, default=str))]
                )
            if name == GET_LIBRARY_MANIFEST_TOOL_NAME:
                result = await run_get_library_manifest(client, arguments or {})
                return CallToolResult(
                    content=[TextContent(type="text", text=json.dumps(result, indent=2, default=str))]
                )
            if name == GET_LIBRARY_EXPORT_TOOL_NAME:
                result = await run_get_library_export(client, arguments or {})
                return CallToolResult(
                    content=[TextContent(type="text", text=result)]
                )
            return CallToolResult(
                isError=True,
                content=[TextContent(type="text", text=f"Unknown tool: {name}")],
            )
        except Exception as exc:  # noqa: BLE001 - surface every error to the MCP client
            logger.exception("tool call failed: %s", name)
            if isinstance(exc, ResemblioApiError):
                message = f"{exc}: {json.dumps(exc.body, separators=(',', ':'))}"
            else:
                message = f"{type(exc).__name__}: {exc}"
            return CallToolResult(
                isError=True,
                content=[TextContent(type="text", text=message)],
            )

    return Server(
        "resemblio-mcp",
        on_list_tools=_list_tools,
        on_call_tool=_call_tool,
    )


def main(argv: Sequence[str] | None = None) -> None:
    """Console-script entrypoint. Resolves config then runs the stdio server."""
    logging.basicConfig(level=logging.INFO)
    try:
        config = resolve_config(
            argv if argv is not None else sys.argv[1:],
            dict(os.environ),
        )
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
    client = ResemblioClient(api_key=config.api_key, base_url=config.base_url)
    asyncio.run(_serve(client))


if __name__ == "__main__":  # pragma: no cover - exercised via console script
    main()

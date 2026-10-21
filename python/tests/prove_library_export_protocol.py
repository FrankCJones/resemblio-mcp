"""Exercise the Python MCP registration over an in-memory protocol.

Run:
    python python/tests/prove_library_export_protocol.py input.json output.json
"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from typing import Any

import httpx
import anyio
from mcp import ClientSession
from mcp.shared.memory import create_client_server_memory_streams

MCP_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(MCP_ROOT / "python" / "src"))

from resemblio_mcp.client import ResemblioClient
from resemblio_mcp.server import build_server


async def prove(input_path: Path, output_path: Path) -> None:
    """Call every supplied case through the registered MCP protocol tool."""

    proof: dict[str, Any] = json.loads(input_path.read_text(encoding="utf-8"))
    cases: list[dict[str, Any]] = proof["cases"]
    request_index = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal request_index
        if request_index >= len(cases):
            return httpx.Response(400, json={"error": "unexpected_request"})
        proof_case = cases[request_index]
        request_index += 1
        if request.url.path != "/v1/apple/exports/dtcg":
            return httpx.Response(400, json={"error": "unexpected_path"})
        return httpx.Response(
            200,
            content=proof_case["body"].encode("utf-8"),
            headers={"content-type": "application/design-tokens+json"},
        )

    api_client = ResemblioClient(
        api_key="rsmb_proof",
        base_url="https://api.resemblio.test",
        transport=httpx.MockTransport(handler),
    )
    bodies: dict[str, str] = {}
    server = build_server(api_client)
    async with create_client_server_memory_streams() as (client_streams, server_streams):
        async with ClientSession(*client_streams) as session:
            async with anyio.create_task_group() as task_group:
                task_group.start_soon(
                    server.run,
                    *server_streams,
                    server.create_initialization_options(),
                )
                await session.initialize()
                for proof_case in cases:
                    result = await session.call_tool(
                        "resemblio_get_library_export",
                        proof_case["arguments"],
                    )
                    if result.is_error or not result.content or result.content[0].type != "text":
                        raise RuntimeError(f"MCP protocol call failed for {proof_case['name']}.")
                    bodies[proof_case["name"]] = result.content[0].text
                task_group.cancel_scope.cancel()

    output_path.write_text(
        json.dumps(
            {
                "schema_version": "resemblio_python_mcp_protocol_proof_v2",
                "bodies": bodies,
            },
            indent=2,
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )


def main() -> None:
    """Validate CLI arguments and run the asynchronous proof."""

    if len(sys.argv) != 3:
        raise SystemExit("Expected input and output JSON paths.")
    asyncio.run(prove(Path(sys.argv[1]), Path(sys.argv[2])))


if __name__ == "__main__":
    main()

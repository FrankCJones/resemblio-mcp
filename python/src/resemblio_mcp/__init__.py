"""Resemblio MCP server (Python).

Public surface:

* :class:`resemblio_mcp.client.ResemblioClient` - thin httpx client
  wrapping the v1 REST API.
* :func:`resemblio_mcp.server.main` - stdio entrypoint registered as the
  ``resemblio-mcp`` console script.
* :mod:`resemblio_mcp.tools` - the extraction, listing, Apple manifest,
  and Apple export tool handlers.
"""

__version__ = "0.3.0"

from resemblio_mcp.client import (
    AppleSystemManifestPayload,
    ExtractionListItem,
    ExtractionListResponse,
    ExtractionManifest,
    ExtractionResponse,
    ResemblioApiError,
    ResemblioClient,
)

__all__ = [
    "AppleSystemManifestPayload",
    "ExtractionListItem",
    "ExtractionListResponse",
    "ExtractionManifest",
    "ExtractionResponse",
    "ResemblioApiError",
    "ResemblioClient",
    "__version__",
]

"""Resemblio MCP server (Python).

Public surface:

* :class:`resemblio_mcp.client.ResemblioClient` - thin httpx client
  wrapping the v1 REST API.
* :func:`resemblio_mcp.server.main` - stdio entrypoint registered as the
  ``resemblio-mcp`` console script.
* :mod:`resemblio_mcp.tools` - the two MCP tool handlers
  (``resemblio_extract`` and ``resemblio_list_extractions``).
"""

__version__ = "0.1.0"

from resemblio_mcp.client import (
    ExtractionListItem,
    ExtractionListResponse,
    ExtractionManifest,
    ExtractionResponse,
    ResemblioApiError,
    ResemblioClient,
)

__all__ = [
    "ExtractionListItem",
    "ExtractionListResponse",
    "ExtractionManifest",
    "ExtractionResponse",
    "ResemblioApiError",
    "ResemblioClient",
    "__version__",
]

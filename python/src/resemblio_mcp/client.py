"""Thin httpx client for the Resemblio v1 REST API.

Wraps the three endpoints the MCP tools consume:

* ``POST /v1/extractions`` - create a charged extraction.
* ``GET  /v1/extractions`` - paginated history (no charge).
* ``GET  /v1/extractions/{id}`` - fetch one cached row (no charge).

Auth model: every call carries ``Authorization: Bearer <api_key>``. The
key is supplied at server-start via the ``RESEMBLIO_API_KEY`` env var or
the ``--api-key`` CLI flag handled in :mod:`resemblio_mcp.server`.

Retry policy: transient HTTP failures (network errors and 5xx
responses) retry up to ``max_retries`` times with exponential backoff.
4xx responses are NOT retried; they raise :class:`ResemblioApiError`
because the customer needs to see them (insufficient credit, invalid
URL, spend cap, etc.). Mirrors the retry posture of
``projects/Resemblio/code/api/app/extractor_bridge.py``.
"""
from __future__ import annotations

import asyncio
from typing import Any

import httpx
from pydantic import BaseModel, ConfigDict

DEFAULT_BASE_URL = "https://api.resemblio.com"
DEFAULT_MAX_RETRIES = 3
DEFAULT_BACKOFF_S = 0.25
DEFAULT_TIMEOUT_S = 60.0


class ExtractionListItem(BaseModel):
    """Compact extraction-history row returned by ``GET /v1/extractions``.

    Matches ``ExtractionListItem`` in ``code/api/app/schemas.py``.
    """

    model_config = ConfigDict(extra="allow")

    id: int
    url: str
    status: str
    extracted_at: str
    schema_version: int


class ExtractionListResponse(BaseModel):
    """Paginated list envelope returned by ``GET /v1/extractions``."""

    model_config = ConfigDict(extra="allow")

    items: list[ExtractionListItem]
    schema_version: int


class ExtractionManifest(BaseModel):
    """v1.1 manifest envelope: the canonical pointer record a client persists.

    Matches ``ExtractionManifest`` in the API schemas. ``tokens_url`` and
    ``download_url`` are presigned and TTL-bounded; clients caching the
    manifest beyond the TTL must re-fetch the parent extraction.
    """

    model_config = ConfigDict(extra="allow")

    id: int
    status: str
    source_url: str
    created_at_utc: str
    schema_version: int
    quality_score: float | None = None
    tokens_url: str | None = None
    download_url: str | None = None


class ExtractionResponse(BaseModel):
    """Full extraction detail returned by POST and GET-by-id.

    Matches ``ExtractionResponse`` in the API schemas. The inline
    ``tokens`` and ``dtcg`` payload is a convenience for one-shot
    integrations; clients that prefer the pointer-only contract should
    read ``manifest.tokens_url`` and ``manifest.download_url``.
    """

    model_config = ConfigDict(extra="allow")

    id: int
    status: str
    tokens: dict[str, Any] | None = None
    dtcg: dict[str, Any] | None = None
    download_url: str | None = None
    schema_version: int
    tokens_url: str | None = None
    manifest: ExtractionManifest | None = None
    error_log: Any | None = None
    error_code: str | None = None
    quality_score: float | None = None
    refunded: bool | None = None


class ExtractionCreateRequest(BaseModel):
    """Request body for ``POST /v1/extractions``.

    ``private`` defaults to False (public extraction, $5/call per the
    pricing table in ``projects/Resemblio/CLAUDE.md``).
    """

    url: str
    private: bool = False


class ResemblioApiError(Exception):
    """Structured API error.

    Carries the HTTP status plus the parsed JSON body (``error_code``,
    ``error_log``, etc.) so the tool layer can surface a useful message
    without re-parsing.
    """

    def __init__(self, status: int, body: Any, message: str | None = None) -> None:
        super().__init__(message or f"Resemblio API error {status}")
        self.status = status
        self.body = body


class ResemblioClient:
    """Async httpx client for the Resemblio v1 REST surface.

    Construction is pure (no network call); all methods are async and
    idempotent except :meth:`create_extraction`, which charges credits
    server-side. ``create_extraction`` accepts an optional idempotency
    key that the API honors per ``code/api/app/idempotency.py``.
    """

    def __init__(
        self,
        api_key: str,
        *,
        base_url: str | None = None,
        max_retries: int = DEFAULT_MAX_RETRIES,
        backoff_s: float = DEFAULT_BACKOFF_S,
        timeout_s: float = DEFAULT_TIMEOUT_S,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        """Build a client. Raises :class:`ValueError` if ``api_key`` is empty."""
        if not api_key or not api_key.strip():
            raise ValueError(
                "ResemblioClient: api_key is required. "
                "Set RESEMBLIO_API_KEY or pass --api-key."
            )
        self._api_key = api_key.strip()
        self._base_url = (base_url or DEFAULT_BASE_URL).rstrip("/")
        self._max_retries = max_retries
        self._backoff_s = backoff_s
        self._timeout_s = timeout_s
        self._transport = transport

    def _new_http_client(self) -> httpx.AsyncClient:
        """Construct a fresh httpx AsyncClient with the configured transport.

        We rebuild per call rather than holding a long-lived client because
        the MCP server is stdio-bound and request volume is low; the
        connection-pool savings would be dwarfed by the lifecycle complexity.
        """
        return httpx.AsyncClient(
            base_url=self._base_url,
            timeout=self._timeout_s,
            transport=self._transport,
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Accept": "application/json",
            },
        )

    async def create_extraction(
        self,
        request: ExtractionCreateRequest,
        idempotency_key: str | None = None,
    ) -> ExtractionResponse:
        """Create a charged extraction. Returns the full response synchronously.

        ``idempotency_key`` (optional) lets a retried call within the
        API's TTL replay the original response without re-charging.
        """
        headers: dict[str, str] = {"content-type": "application/json"}
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        payload = await self._request(
            "POST", "/v1/extractions", json=request.model_dump(mode="json"), extra_headers=headers
        )
        return ExtractionResponse.model_validate(payload)

    async def list_extractions(
        self,
        *,
        limit: int | None = None,
        before: int | None = None,
    ) -> ExtractionListResponse:
        """List the calling user's extraction history (newest first).

        ``limit`` is bounded server-side to [1, 100]. ``before`` is a
        cursor on extraction id.
        """
        params: dict[str, int] = {}
        if limit is not None:
            params["limit"] = limit
        if before is not None:
            params["before"] = before
        payload = await self._request("GET", "/v1/extractions", params=params or None)
        return ExtractionListResponse.model_validate(payload)

    async def get_extraction(self, extraction_id: int) -> ExtractionResponse:
        """Fetch a previously-completed extraction by id without re-charging."""
        payload = await self._request("GET", f"/v1/extractions/{extraction_id}")
        return ExtractionResponse.model_validate(payload)

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json: Any = None,
        params: dict[str, Any] | None = None,
        extra_headers: dict[str, str] | None = None,
    ) -> Any:
        """Issue one HTTP request with retry-on-5xx and structured-error-on-4xx.

        Network exceptions (httpx.TransportError, httpx.TimeoutException)
        also enter the retry loop. 4xx responses raise
        :class:`ResemblioApiError` immediately without retry.
        """
        last_exc: Exception | None = None
        async with self._new_http_client() as http:
            for attempt in range(self._max_retries + 1):
                try:
                    response = await http.request(
                        method,
                        path,
                        json=json,
                        params=params,
                        headers=extra_headers,
                    )
                    if 200 <= response.status_code < 300:
                        return response.json()
                    body = self._safe_json(response)
                    if 400 <= response.status_code < 500:
                        raise ResemblioApiError(response.status_code, body)
                    last_exc = ResemblioApiError(response.status_code, body)
                except (httpx.TransportError, httpx.TimeoutException) as exc:
                    last_exc = exc
                if attempt < self._max_retries:
                    await asyncio.sleep(self._backoff_s * (2 ** attempt))
        assert last_exc is not None  # loop must have set this on exhaustion
        raise last_exc

    @staticmethod
    def _safe_json(response: httpx.Response) -> Any:
        """Parse a response body as JSON, returning None on any error."""
        try:
            return response.json()
        except Exception:  # noqa: BLE001 - error-body parsing is best-effort
            return None

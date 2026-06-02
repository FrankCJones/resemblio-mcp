"""Unit tests for the pure-data tool helpers.

Tests :func:`summarize` and :func:`shape_list_response` directly. The
end-to-end tool handlers (which call the API client) are exercised
indirectly by the client tests; here we keep the surface synchronous
and offline.
"""
from __future__ import annotations

from resemblio_mcp.client import (
    ExtractionListItem,
    ExtractionListResponse,
    ExtractionResponse,
)
from resemblio_mcp.tools import shape_list_response, summarize


def test_summarize_counts_palette_and_fonts():
    """A populated tokens payload yields non-zero counts."""
    response = ExtractionResponse(
        id=1,
        status="ok",
        tokens={"palette": {"red": "#f00", "blue": "#00f"}, "fonts": ["Inter", "Roboto"]},
        dtcg={"color": {}},
        download_url="https://example.com/x.zip",
        schema_version=2,
        tokens_url="https://example.com/tokens.json",
        manifest=None,
    )
    summary = summarize(response)
    assert summary["palette_color_count"] == 2
    assert summary["font_count"] == 2
    assert summary["has_dtcg"] is True
    assert summary["has_zip"] is True


def test_summarize_zero_when_tokens_missing():
    """Missing tokens / dtcg / download_url surface as zero/False."""
    response = ExtractionResponse(
        id=2,
        status="failed",
        tokens=None,
        dtcg=None,
        download_url=None,
        schema_version=2,
        tokens_url=None,
        manifest=None,
    )
    summary = summarize(response)
    assert summary["palette_color_count"] == 0
    assert summary["font_count"] == 0
    assert summary["has_dtcg"] is False
    assert summary["has_zip"] is False


def test_shape_list_response_counts_items():
    """The list reshape must echo schema_version and report the page size."""
    envelope = ExtractionListResponse(
        items=[
            ExtractionListItem(
                id=1, url="https://a", status="ok", extracted_at="2026-06-02T00:00:00Z", schema_version=2
            ),
            ExtractionListItem(
                id=2, url="https://b", status="ok", extracted_at="2026-06-02T00:00:00Z", schema_version=2
            ),
        ],
        schema_version=2,
    )
    out = shape_list_response(envelope)
    assert out["total"] == 2
    assert out["schema_version"] == 2
    assert len(out["items"]) == 2

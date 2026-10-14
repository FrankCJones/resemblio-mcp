"""Generate the exact API export artifacts used by MCP protocol tests.

This deterministic test utility imports the API's pure artifact builder and
writes the resulting JSON fixture without making network calls.

Run:
    python python/tests/generate_exact_export_fixture.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Final


FIXTURE_PATH: Final = (
    Path(__file__).resolve().parents[2]
    / "tests"
    / "fixtures"
    / "library-export-artifacts.json"
)


def build_fixture() -> dict[str, Any]:
    """Build the five checkpoint selections from the API implementation."""

    api_root = Path(__file__).resolve().parents[3] / "api"
    sys.path.insert(0, str(api_root))
    from app.apple_export_product import build_apple_dtcg_export

    selections: dict[str, tuple[str, str | None, tuple[str, ...]]] = {
        "complete": ("complete", None, ()),
        "classification-foundation": ("classification", "foundation", ()),
        "classification-component": ("classification", "component", ()),
        "classification-composition": ("classification", "composition", ()),
        "records-normalized": (
            "record",
            None,
            ("component:buttons", "foundation:color-scale", "component:buttons"),
        ),
    }
    return {
        "schema_version": "resemblio_mcp_library_export_fixture_v2",
        "artifacts": {
            name: build_apple_dtcg_export(
                kind,
                classification=classification,
                record_ids=record_ids,
            )
            for name, (kind, classification, record_ids) in selections.items()
        },
    }


def main() -> None:
    """Write the deterministic fixture to the shared MCP test directory."""

    FIXTURE_PATH.write_text(
        json.dumps(build_fixture(), indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()

"""Generate the exact API export artifacts used by MCP protocol tests.

This deterministic maintenance utility imports the API's pure artifact builder
from an explicitly supplied checkout and writes the resulting JSON fixture
without making network calls. Release tests use the checked-in fixture and its
integrity-pinned provenance, so a standalone MCP checkout remains self-contained.

Run:
    python python/tests/generate_exact_export_fixture.py PATH_TO_API_CHECKOUT
"""
from __future__ import annotations

import argparse
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


def build_fixture(api_root: Path) -> dict[str, Any]:
    """Build five selections from an explicit API checkout without network use."""

    resolved_api_root = api_root.resolve()
    if not (resolved_api_root / "app" / "apple_export_product.py").is_file():
        raise FileNotFoundError("API checkout does not contain app/apple_export_product.py")
    sys.path.insert(0, str(resolved_api_root))
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
    """Parse one API checkout path and rewrite the deterministic fixture."""

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("api_root", type=Path, help="Path to a reviewed Resemblio API checkout")
    args = parser.parse_args()

    FIXTURE_PATH.write_text(
        json.dumps(build_fixture(args.api_root), indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()

"""Integrity and provenance checks for repository-local release fixtures."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Final


FIXTURE_ROOT: Final = Path(__file__).resolve().parents[2] / "tests" / "fixtures"
EXPECTED_SELECTIONS: Final = {
    "complete",
    "classification-foundation",
    "classification-component",
    "classification-composition",
    "records-normalized",
}


def _lf_sha256(path: Path) -> str:
    """Return the SHA-256 digest after deterministic LF normalization."""

    return hashlib.sha256(path.read_bytes().replace(b"\r\n", b"\n")).hexdigest()


def _load_json(path: Path) -> dict[str, Any]:
    """Load one object-shaped JSON fixture or fail with a clear assertion."""

    value = json.loads(path.read_text(encoding="utf-8"))
    assert isinstance(value, dict)
    return value


def test_fixture_hashes_match_pinned_api_provenance() -> None:
    """Vendored fixture bytes must match the reviewed API release inputs."""

    provenance = _load_json(FIXTURE_ROOT / "fixture-provenance.json")
    assert provenance["schema_version"] == "resemblio_mcp_fixture_provenance_v1"
    assert provenance["source_api_commit"] == "afa18c7931350d9fb306b2d66384683755c9d96a"
    assert provenance["fixture_line_endings"] == "lf"
    for fixture in provenance["fixtures"]:
        path = FIXTURE_ROOT / fixture["path"]
        assert path.is_file()
        assert _lf_sha256(path) == fixture["sha256"]


def test_export_fixture_references_the_vendored_manifest() -> None:
    """Every exact export fixture must retain the vendored manifest identity."""

    manifest = _load_json(FIXTURE_ROOT / "apple-system-manifest.json")
    exports = _load_json(FIXTURE_ROOT / "library-export-artifacts.json")
    assert manifest["schema_version"] == "resemblio_apple_system_manifest_v1"
    assert len(manifest["records"]) == 41
    assert exports["schema_version"] == "resemblio_mcp_library_export_fixture_v2"
    assert set(exports["artifacts"]) == EXPECTED_SELECTIONS
    for artifact in exports["artifacts"].values():
        reference = artifact["manifest"]["source_manifest_reference"]
        assert reference["artifact_sha256"] == manifest["artifact_sha256"]
        assert reference["record_count"] == len(manifest["records"])

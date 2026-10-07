"""Reproducibility check for the exact API artifact fixture."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from generate_exact_export_fixture import FIXTURE_PATH, build_fixture


def test_exact_export_fixture_matches_api_builder() -> None:
    """The checked-in fixture must equal a fresh API builder result."""

    assert json.loads(FIXTURE_PATH.read_text(encoding="utf-8")) == build_fixture()

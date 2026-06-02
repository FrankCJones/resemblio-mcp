"""Unit tests for :func:`resemblio_mcp.server.parse_args` and :func:`resolve_config`.

These are pure functions; no MCP SDK import is needed (the SDK is
lazy-imported inside :func:`resemblio_mcp.server._serve` so this test
suite runs whether or not ``mcp`` is installed in the test environment).
"""
from __future__ import annotations

import pytest

from resemblio_mcp.server import parse_args, resolve_config


def test_parse_args_reads_both_flags():
    out = parse_args(["--api-key", "k", "--base-url", "https://x"])
    assert out == {"api_key": "k", "base_url": "https://x"}


def test_parse_args_ignores_unknown_flags():
    out = parse_args(["--unknown", "v", "--api-key", "k"])
    assert out == {"api_key": "k"}


def test_resolve_config_cli_overrides_env():
    cfg = resolve_config(
        ["--api-key", "from-cli"],
        {"RESEMBLIO_API_KEY": "from-env", "RESEMBLIO_BASE_URL": "https://env"},
    )
    assert cfg.api_key == "from-cli"
    assert cfg.base_url == "https://env"


def test_resolve_config_env_when_no_cli():
    cfg = resolve_config([], {"RESEMBLIO_API_KEY": "env-key"})
    assert cfg.api_key == "env-key"
    assert cfg.base_url is None


def test_resolve_config_raises_when_no_key_anywhere():
    with pytest.raises(RuntimeError, match="no API key"):
        resolve_config([], {})

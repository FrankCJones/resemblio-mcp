"""Voice-rule test for the Python MCP server's public-facing copy.

Phase 0 carry-forward (2026-06-04 Inspirado correction plan), YELLOW
item 3: the Python edition's user-visible descriptions must not advertise
"brand-stripped" framing after the 2026-06-04 lock.

Three surfaces are pinned here:

1. ``pyproject.toml#project.description`` -- what PyPI renders.
2. ``README.md`` lede -- what GitHub renders.
3. ``src/resemblio_mcp/*.py`` string literals -- what MCP clients (Claude
   Code, etc.) render as tool descriptions at runtime.

The TypeScript edition's surfaces are pinned by
``code/mcp/tests/descriptions-framing.test.ts``.

Run command (from ``code/mcp/python/``):

    pytest tests/test_descriptions_framing.py
"""
from __future__ import annotations

import re
from pathlib import Path

# Repo paths (relative to this test file).
HERE = Path(__file__).resolve().parent
PKG_ROOT = HERE.parent

# Banned framings, kept in lock-step with the web app's library-copy.ts
# and the TS MCP edition.
BANNED_FRAMINGS = (
    re.compile(r"brand[-\s]stripped", re.IGNORECASE),
    re.compile(r"stripped of brand", re.IGNORECASE),
    re.compile(r"brand removed", re.IGNORECASE),
)

# At least one of these phrases must appear, so the reframe is positively
# asserted rather than only negatively constrained.
REFRAME_ANCHOR = re.compile(
    r"inspirado|brand[-\s]faithful|trademark[-\s]stripped", re.IGNORECASE
)


def _read(rel: str) -> str:
    return (PKG_ROOT / rel).read_text(encoding="utf-8")


def test_pyproject_description_has_no_banned_framing() -> None:
    """``project.description`` in pyproject.toml is the PyPI search snippet."""
    contents = _read("pyproject.toml")
    # Extract just the `description = "..."` line under [project].
    match = re.search(r"^description\s*=\s*\"([^\"]+)\"", contents, re.MULTILINE)
    assert match is not None, "pyproject.toml must declare a project description"
    description = match.group(1)

    for banned in BANNED_FRAMINGS:
        assert not banned.search(description), (
            f"pyproject.toml description must not match {banned.pattern!r}; "
            f"got: {description!r}"
        )


def test_pyproject_description_reflects_inspirado_reframe() -> None:
    """Positive assertion: the new framing must be present, not just absent."""
    contents = _read("pyproject.toml")
    match = re.search(r"^description\s*=\s*\"([^\"]+)\"", contents, re.MULTILINE)
    assert match is not None
    description = match.group(1)

    assert REFRAME_ANCHOR.search(description), (
        f"pyproject.toml description should carry the Inspirado reframe; "
        f"got: {description!r}"
    )


def test_readme_lede_has_no_banned_framing() -> None:
    """The README lede is the GitHub repo page's top-of-fold copy."""
    readme = _read("README.md")
    lede = readme.split("\n## ", 1)[0]

    for banned in BANNED_FRAMINGS:
        assert not banned.search(lede), (
            f"README.md lede must not match {banned.pattern!r}; got lede: {lede!r}"
        )


def test_readme_lede_reflects_inspirado_reframe() -> None:
    """Positive assertion: the README lede must include the new framing."""
    readme = _read("README.md")
    lede = readme.split("\n## ", 1)[0]

    assert REFRAME_ANCHOR.search(lede), (
        f"README.md lede should carry the Inspirado reframe; got lede: {lede!r}"
    )


def _iter_source_files() -> list[Path]:
    """Return every ``.py`` file under ``src/resemblio_mcp/``.

    Tool descriptions rendered to MCP clients live in code string literals,
    not just package metadata. The 2026-06-05 L9 scaffold caught a
    "brand-stripped" hit in ``server.py`` line 114 that the metadata-only
    tests missed. This helper closes that seam.
    """
    pkg_src = PKG_ROOT / "src" / "resemblio_mcp"
    return sorted(pkg_src.rglob("*.py"))


def test_source_files_have_no_banned_framing() -> None:
    """MCP client-facing strings (tool descriptions) live in the source."""
    sources = _iter_source_files()
    assert sources, "expected at least one .py file under src/resemblio_mcp/"

    for path in sources:
        contents = path.read_text(encoding="utf-8")
        for banned in BANNED_FRAMINGS:
            match = banned.search(contents)
            assert match is None, (
                f"{path.relative_to(PKG_ROOT)} must not match {banned.pattern!r}; "
                f"hit: {match.group(0)!r}"
            )

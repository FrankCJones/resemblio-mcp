/**
 * descriptions-framing.test.ts
 *
 * Phase 0 carry-forward (2026-06-04 Inspirado correction plan), YELLOW
 * item 3: MCP description surfaces must not advertise "brand-stripped"
 * framing after the 2026-06-04 lock.
 *
 * Three public-facing description surfaces are pinned here:
 *
 *   1. The MCP tool `description` field on `resemblio_extract` (what
 *      MCP clients show inside Claude Desktop, Cursor, Codex CLI).
 *   2. `package.json#description` (what npmjs.com renders).
 *   3. `README.md` lede (what GitHub renders).
 *
 * The python edition is pinned by its own test under
 * `code/mcp/python/tests/` (out of scope here; the JS test confirms the
 * JS surface).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractTool } from '../src/tools/extract.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(HERE, '..');

/** All banned framings, kept in lock-step with the web app's library-copy.ts. */
const BANNED_FRAMINGS: ReadonlyArray<RegExp> = [
  /brand[-\s]stripped/i,
  /stripped of brand/i,
  /brand removed/i,
];

function readFile(rel: string): string {
  return readFileSync(path.join(PKG_ROOT, rel), 'utf8');
}

describe('MCP extract tool description (closes YELLOW item 3)', () => {
  it('does not include any banned "brand-stripped" framing', () => {
    for (const re of BANNED_FRAMINGS) {
      expect(
        re.test(extractTool.description),
        `extractTool.description must not match ${re}; got: ${JSON.stringify(extractTool.description)}`,
      ).toBe(false);
    }
  });

  it('carries the Inspirado-no-copiado anchor so MCP clients show the corrected framing', () => {
    expect(
      /inspirado|brand[-\s]faithful|trademark[-\s]stripped/i.test(
        extractTool.description,
      ),
      `extractTool.description should reflect the Inspirado reframe; got: ${JSON.stringify(extractTool.description)}`,
    ).toBe(true);
  });
});

describe('package.json description (closes YELLOW item 3)', () => {
  const pkg = JSON.parse(readFile('package.json')) as { description: string };

  it('does not include any banned framing', () => {
    for (const re of BANNED_FRAMINGS) {
      expect(
        re.test(pkg.description),
        `package.json#description must not match ${re}; got: ${JSON.stringify(pkg.description)}`,
      ).toBe(false);
    }
  });

  it('reflects the Inspirado reframe', () => {
    expect(/inspirado|brand[-\s]faithful|trademark[-\s]stripped/i.test(pkg.description)).toBe(true);
  });
});

describe('README.md lede (closes YELLOW item 3)', () => {
  const readme = readFile('README.md');
  // The lede is everything above the first ## section header.
  const lede = readme.split(/^##\s/m)[0] ?? '';

  it('does not include any banned framing in the lede', () => {
    for (const re of BANNED_FRAMINGS) {
      expect(
        re.test(lede),
        `README.md lede must not match ${re}`,
      ).toBe(false);
    }
  });

  it('reflects the Inspirado reframe in the lede', () => {
    expect(/inspirado|brand[-\s]faithful|trademark[-\s]stripped/i.test(lede)).toBe(true);
  });
});

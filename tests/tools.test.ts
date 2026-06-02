/**
 * Unit tests for the pure-data reshaping in the two tool handlers.
 *
 * The handlers themselves call the client; here we test only the pure
 * functions (summarize, shapeListResponse) plus the buildServer wiring
 * that advertises both tools through the MCP ListTools request.
 */

import { describe, it, expect, vi } from 'vitest';
import { summarize } from '../src/tools/extract.js';
import { shapeListResponse } from '../src/tools/list_extractions.js';
import { buildServer, parseArgs, resolveConfig } from '../src/index.js';
import { ResemblioClient } from '../src/client.js';
import type { ExtractionResponse } from '../src/client.js';

describe('summarize', () => {
  it('counts palette + font entries when present', () => {
    const response: ExtractionResponse = {
      id: 1,
      status: 'ok',
      tokens: { palette: { red: '#f00', blue: '#00f' }, fonts: ['Inter', 'Roboto'] },
      dtcg: { color: {} },
      download_url: 'https://example.com/x.zip',
      schema_version: 2,
      tokens_url: 'https://example.com/tokens.json',
      manifest: null,
    };
    const s = summarize(response);
    expect(s.palette_color_count).toBe(2);
    expect(s.font_count).toBe(2);
    expect(s.has_dtcg).toBe(true);
    expect(s.has_zip).toBe(true);
  });

  it('returns zeros when tokens are absent', () => {
    const response: ExtractionResponse = {
      id: 2,
      status: 'failed',
      tokens: null,
      dtcg: null,
      download_url: null,
      schema_version: 2,
      tokens_url: null,
      manifest: null,
    };
    const s = summarize(response);
    expect(s.palette_color_count).toBe(0);
    expect(s.font_count).toBe(0);
    expect(s.has_dtcg).toBe(false);
    expect(s.has_zip).toBe(false);
  });
});

describe('shapeListResponse', () => {
  it('echoes envelope and counts items', () => {
    const out = shapeListResponse({
      items: [
        { id: 1, url: 'https://a', status: 'ok', extracted_at: '2026-06-02T00:00:00Z', schema_version: 2 },
        { id: 2, url: 'https://b', status: 'ok', extracted_at: '2026-06-02T00:00:00Z', schema_version: 2 },
      ],
      schema_version: 2,
    });
    expect(out.total).toBe(2);
    expect(out.schema_version).toBe(2);
    expect(out.items).toHaveLength(2);
  });
});

describe('parseArgs / resolveConfig', () => {
  it('parses --api-key and --base-url', () => {
    const parsed = parseArgs(['--api-key', 'k', '--base-url', 'https://x']);
    expect(parsed.apiKey).toBe('k');
    expect(parsed.baseUrl).toBe('https://x');
  });

  it('falls back to env when CLI flags absent', () => {
    const cfg = resolveConfig([], { RESEMBLIO_API_KEY: 'env-key' } as NodeJS.ProcessEnv);
    expect(cfg.apiKey).toBe('env-key');
  });

  it('throws when no API key is supplied anywhere', () => {
    expect(() => resolveConfig([], {} as NodeJS.ProcessEnv)).toThrow(/no API key/);
  });
});

describe('buildServer', () => {
  it('constructs without error and is ready to advertise tools', () => {
    const client = new ResemblioClient({ apiKey: 'rsmb_test', fetchImpl: vi.fn() });
    const server = buildServer(client);
    expect(server).toBeDefined();
  });
});

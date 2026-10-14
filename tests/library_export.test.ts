/** Tests the live API retrieval contract with API-owned canonical records. */
import { readFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';
import {
  APPLE_LIBRARY_EXPORT_PATH,
  ResemblioApiError,
  ResemblioClient,
  type AppleLibraryExport,
  validateAppleLibraryExportResponse,
} from '../src/client.js';
import { getLibraryExportTool, normalizeLibraryExportInput, runGetLibraryExport } from '../src/tools/get_library_export.js';
import { buildServer } from '../src/index.js';

interface ExactExportFixture {
  schema_version: string;
  artifacts: Record<string, AppleLibraryExport>;
}

async function exactExportFixture(): Promise<ExactExportFixture> {
  const text = await readFile(new URL('./fixtures/library-export-artifacts.json', import.meta.url), 'utf8');
  return JSON.parse(text) as ExactExportFixture;
}

async function callRegisteredExportTool(
  apiClient: ResemblioClient,
  args: Record<string, unknown>,
): Promise<{ isError?: boolean; artifact?: AppleLibraryExport; text: string }> {
  const server = buildServer(apiClient);
  const protocolClient = new Client(
    { name: 'resemblio-checkpoint-three-test', version: '1.0.0' },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await protocolClient.connect(clientTransport);
  try {
    const result = await protocolClient.callTool({
      name: getLibraryExportTool.name,
      arguments: args,
    });
    const block = result.content[0];
    if (!block || block.type !== 'text') {
      throw new Error('Expected one MCP text result.');
    }
    return {
      isError: result.isError,
      artifact: result.isError ? undefined : JSON.parse(block.text) as AppleLibraryExport,
      text: block.text,
    };
  } finally {
    await protocolClient.close();
    await server.close();
  }
}

async function manifestRecords(): Promise<Record<string, unknown>[]> {
  const text = await readFile(new URL('../../api/app/data/apple_system_manifest.json', import.meta.url), 'utf8');
  return (JSON.parse(text) as { records: Record<string, unknown>[] }).records;
}

function exportArtifact(records: Record<string, unknown>[], selection: string): AppleLibraryExport {
  return {
    tokens: { color: { bg: { $type: 'color', $value: { colorSpace: 'srgb', components: [1, 1, 1], alpha: 1 } } } },
    manifest: {
      schema_version: 'resemblio_apple_export_manifest_v2',
      artifact_id: 'apple-system-dtcg',
      artifact_version: '2026.10.14',
      exporter_version: '2.0.0',
      normalization_policy_version: 'dtcg_2025_10_public_safe_v3',
      reproducibility: { mode: 'deterministic' },
      artifact_fingerprint: 'a'.repeat(64),
      manifest_sha256: 'b'.repeat(64),
      source_manifest_reference: { artifact_sha256: 'c'.repeat(64) },
      tokens: {
        path: 'tokens/design.tokens.json',
        media_type: 'application/design-tokens+json',
        schema_url: 'https://www.designtokens.org/schemas/2025.10/format.json',
        sha256: 'd'.repeat(64), count: 1, domains: ['color'],
      },
      selection: { kind: selection, selected_record_count: records.length },
      attribution: {},
      scrub_policy: {},
      records,
      dependencies: [],
    },
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('resemblio_get_library_export', () => {
  it('preserves the two API-owned values and object identity without reconstruction', () => {
    const data = exportArtifact([], 'complete');
    const result = validateAppleLibraryExportResponse({ schema_version: 2, data });
    expect(result).toBe(data);
    expect(result.tokens).toBe(data.tokens);
    expect(result.manifest).toBe(data.manifest);
    expect(Object.keys(result)).toEqual(['tokens', 'manifest']);
  });

  it.each([
    ['schema_version', 'resemblio_apple_export_product_v1'],
    ['artifact_fingerprint', 'A'.repeat(64)],
    ['manifest_sha256', 'bad-hash'],
    ['records', [null]],
    ['dependencies', [null]],
    ['selection', null],
    ['reproducibility', null],
    ['artifact_version', ''],
  ])('rejects invalid manifest %s', (field, value) => {
    const data = exportArtifact([], 'complete');
    (data.manifest as Record<string, unknown>)[field] = value;
    expect(() => validateAppleLibraryExportResponse({ schema_version: 2, data })).toThrow();
  });

  it.each([
    ['path', 'design.tokens.json'], ['media_type', 'application/json'],
    ['sha256', 'A'.repeat(64)], ['schema_url', ''], ['count', -1],
    ['domains', [null]],
  ])('rejects invalid token descriptor %s', (field, value) => {
    const data = exportArtifact([], 'complete');
    (data.manifest.tokens as unknown as Record<string, unknown>)[field] = value;
    expect(() => validateAppleLibraryExportResponse({ schema_version: 2, data })).toThrow();
  });

  it('rejects the removed proprietary envelope and malformed named values', () => {
    const valid = exportArtifact([], 'complete');
    for (const data of [valid.manifest, { tokens: null, manifest: valid.manifest },
      { tokens: valid.tokens, manifest: null }, { tokens: [], manifest: valid.manifest }]) {
      expect(() => validateAppleLibraryExportResponse({ schema_version: 2, data })).toThrow();
    }
  });

  it('rejects malformed hashes nested in source references', () => {
    const data = exportArtifact([], 'complete');
    data.manifest.source_manifest_reference.artifact_sha256 = 'bad';
    expect(() => validateAppleLibraryExportResponse({ schema_version: 2, data })).toThrow();
  });

  it.each([
    'schema_version', 'artifact_id', 'artifact_version', 'exporter_version',
    'normalization_policy_version', 'reproducibility', 'artifact_fingerprint',
    'manifest_sha256', 'source_manifest_reference', 'tokens', 'selection',
    'attribution', 'scrub_policy', 'records', 'dependencies',
  ])('rejects missing required manifest field %s', (field) => {
    const data = exportArtifact([], 'complete');
    delete (data.manifest as Record<string, unknown>)[field];
    expect(() => validateAppleLibraryExportResponse({ schema_version: 2, data })).toThrow();
  });

  it.each(['path', 'media_type', 'schema_url', 'sha256', 'count', 'domains'])
    ('rejects missing token descriptor field %s', (field) => {
      const data = exportArtifact([], 'complete');
      delete (data.manifest.tokens as unknown as Record<string, unknown>)[field];
      expect(() => validateAppleLibraryExportResponse({ schema_version: 2, data })).toThrow();
    });
  it('retrieves exact complete and normalized API artifacts through the registered MCP protocol', async () => {
    const fixture = await exactExportFixture();
    const calls = new Map<string, AppleLibraryExport>([
      ['complete', fixture.artifacts.complete],
      ['record', fixture.artifacts['records-normalized']],
    ]);
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const artifact = calls.get(url.searchParams.get('selection') ?? '');
      if (!artifact) {
        return jsonResponse(400, { error: 'unexpected_selector' });
      }
      return jsonResponse(200, { schema_version: 2, data: artifact });
    });
    const apiClient = new ResemblioClient({ apiKey: 'rsmb_test', fetchImpl });

    const complete = await callRegisteredExportTool(apiClient, { selection: 'complete' });
    const normalized = await callRegisteredExportTool(apiClient, {
      selection: 'record',
      record_ids: ['foundation:color-scale', 'component:buttons', 'component:buttons'],
    });

    expect(complete.isError).not.toBe(true);
    expect(complete.artifact).toEqual(fixture.artifacts.complete);
    expect(normalized.isError).not.toBe(true);
    expect(normalized.artifact).toEqual(fixture.artifacts['records-normalized']);
    const normalizedRequest = new URL(String(fetchImpl.mock.calls[1]?.[0]));
    expect(normalizedRequest.searchParams.getAll('record')).toEqual([
      'component:buttons',
      'foundation:color-scale',
    ]);
  });

  it('marks stable API errors as MCP protocol errors with the body preserved', async () => {
    const errorBody = { error: 'unknown_record', detail: 'Every selected record must exist.' };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(400, errorBody));
    const result = await callRegisteredExportTool(
      new ResemblioClient({ apiKey: 'rsmb_test', fetchImpl, maxRetries: 3 }),
      { selection: 'record', record_ids: ['component:unknown'] },
    );

    expect(result.isError).toBe(true);
    expect(result.text).toContain(JSON.stringify(errorBody));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('matches the shared Python and TypeScript selector schema contract', async () => {
    const expected = JSON.parse(await readFile(new URL('./fixtures/library-export-input-schema.json', import.meta.url), 'utf8'));
    expect(getLibraryExportTool.inputSchema).toEqual(expected);
  });

  it('retrieves the complete API artifact with the real 41-record canonical set', async () => {
    const records = await manifestRecords();
    const artifact = exportArtifact(records, 'complete');
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { schema_version: 2, data: artifact }));
    const client = new ResemblioClient({ apiKey: 'rsmb_test', fetchImpl });
    const result = await runGetLibraryExport(client, { selection: 'complete' });
    expect(new URL(String(fetchImpl.mock.calls[0]?.[0])).pathname).toBe(APPLE_LIBRARY_EXPORT_PATH);
    expect(result).toEqual(artifact);
    expect(result.manifest.records).toHaveLength(41);
    expect(result.manifest.selection.selected_record_count).toBe(41);
  });

  it('retrieves a classification slice and returns API data unchanged', async () => {
    const records = (await manifestRecords()).filter((record) => record.classification === 'component');
    const artifact = exportArtifact(records, 'classification');
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { schema_version: 2, data: artifact }));
    const result = await new ResemblioClient({ apiKey: 'rsmb_test', fetchImpl })
      .getAppleLibraryExport({ selection: 'classification', classification: 'component' });
    const requestUrl = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(requestUrl.searchParams.get('selection')).toBe('classification');
    expect(requestUrl.searchParams.get('classification')).toBe('component');
    expect(result).toEqual(artifact);
    expect(result.manifest.records).toHaveLength(17);
    expect(result.manifest.records.every((record) => record.classification === 'component')).toBe(true);
  });

  it('normalizes duplicate and reordered record IDs before making a request', () => {
    expect(normalizeLibraryExportInput({
      selection: 'record', record_ids: ['foundation:color-scale', 'component:buttons', 'component:buttons'],
    })).toEqual({ selection: 'record', record_ids: ['component:buttons', 'foundation:color-scale'] });
  });

  it('serializes normalized record selections as repeated API query parameters', async () => {
    const records = (await manifestRecords()).filter((record) =>
      ['component:buttons', 'foundation:color-scale'].includes(String(record.record_id)),
    );
    const artifact = exportArtifact(records, 'record');
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { schema_version: 2, data: artifact }));
    await runGetLibraryExport(new ResemblioClient({ apiKey: 'rsmb_test', fetchImpl }), {
      selection: 'record',
      record_ids: ['foundation:color-scale', 'component:buttons', 'component:buttons'],
    });
    const query = new URL(String(fetchImpl.mock.calls[0]?.[0])).searchParams;
    expect(query.getAll('selection')).toEqual(['record']);
    expect(query.getAll('record')).toEqual(['component:buttons', 'foundation:color-scale']);
  });

  it('rejects malformed and mixed selectors before network access', async () => {
    const fetchImpl = vi.fn();
    const client = new ResemblioClient({ apiKey: 'rsmb_test', fetchImpl });
    await expect(runGetLibraryExport(client, { selection: 'complete', record_ids: ['component:buttons'] }))
      .rejects.toThrow('mixed_selection_contracts');
    await expect(runGetLibraryExport(client, { selection: 'classification', classification: 'other' }))
      .rejects.toThrow('invalid_classification');
    await expect(runGetLibraryExport(client, { selection: 'record', record_ids: [] }))
      .rejects.toThrow('missing_records');
    await expect(runGetLibraryExport(client, { selection: 'record', record_ids: ['Buttons'] }))
      .rejects.toThrow('invalid_record_id');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('preserves stable API selector errors and does not retry 4xx responses', async () => {
    const errorBody = { error: 'unknown_record', detail: 'Every selected record must exist.' };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(400, errorBody));
    const client = new ResemblioClient({ apiKey: 'rsmb_test', fetchImpl, maxRetries: 3 });
    await expect(client.getAppleLibraryExport({ selection: 'record', record_ids: ['component:unknown'] }))
      .rejects.toMatchObject({ status: 400, body: errorBody });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retains the existing retry behavior for transient export failures', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(503, { error: 'unavailable' }));
    const client = new ResemblioClient({ apiKey: 'rsmb_test', fetchImpl, maxRetries: 2, backoffMs: 1 });
    await expect(client.getAppleLibraryExport({ selection: 'complete' })).rejects.toBeInstanceOf(ResemblioApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

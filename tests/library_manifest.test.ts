/** Tests for the Phase 2 canonical Apple MCP consumer. */
import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { APPLE_SYSTEM_MANIFEST_PATH, ResemblioApiError, ResemblioClient } from '../src/client.js';
import { runGetLibraryManifest } from '../src/tools/get_library_manifest.js';

const KNOWN_ARTIFACT_SHA256 = '789cb9743f6b84ff5274ad915b6fc89cf5e76d4ec0d8bc52db30b3a07d95b547';

async function canonicalArtifact(): Promise<Record<string, unknown>> {
  const text = await readFile(new URL('../../api/app/data/apple_system_manifest.json', import.meta.url), 'utf8');
  return JSON.parse(text) as Record<string, unknown>;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('Apple system manifest client', () => {
  it('requests the fixed endpoint and returns the canonical artifact unchanged', async () => {
    const artifact = await canonicalArtifact();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { schema_version: 2, data: artifact }));
    const client = new ResemblioClient({ apiKey: 'rsmb_test', fetchImpl });
    const result = await client.getAppleSystemManifest();
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(APPLE_SYSTEM_MANIFEST_PATH);
    expect(result).toEqual(artifact);
    expect(result.artifact_sha256).toBe(KNOWN_ARTIFACT_SHA256);
  });

  it('rejects an artifact with an unsupported schema', async () => {
    const artifact = { ...(await canonicalArtifact()), schema_version: 'wrong' };
    const client = new ResemblioClient({ apiKey: 'rsmb_test', fetchImpl: vi.fn().mockResolvedValue(jsonResponse(200, { schema_version: 2, data: artifact })) });
    await expect(client.getAppleSystemManifest()).rejects.toThrow(/unsupported schema_version/);
  });

  it('rejects a digest mismatch', async () => {
    const artifact = { ...(await canonicalArtifact()), artifact_sha256: '0'.repeat(64) };
    const client = new ResemblioClient({ apiKey: 'rsmb_test', fetchImpl: vi.fn().mockResolvedValue(jsonResponse(200, { schema_version: 2, data: artifact })) });
    await expect(client.getAppleSystemManifest()).rejects.toThrow(/does not match/);
  });

  it('surfaces endpoint errors after the configured retry budget', async () => {
    const client = new ResemblioClient({ apiKey: 'rsmb_test', maxRetries: 0, fetchImpl: vi.fn().mockResolvedValue(jsonResponse(503, { error: 'unavailable' })) });
    await expect(client.getAppleSystemManifest()).rejects.toBeInstanceOf(ResemblioApiError);
  });
});

it('returns the client artifact by identity without a tool wrapper', async () => {
  const artifact = await canonicalArtifact();
  const client = { getAppleSystemManifest: vi.fn().mockResolvedValue(artifact) } as unknown as ResemblioClient;
  await expect(runGetLibraryManifest(client)).resolves.toBe(artifact);
});

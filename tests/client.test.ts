/**
 * Unit tests for the ResemblioClient HTTP layer.
 *
 * Pure tests: every fetch is replaced with a vitest mock so the suite
 * runs offline. Verifies:
 *   - Bearer header is attached
 *   - 4xx responses surface as ResemblioApiError without retry
 *   - 5xx responses retry up to maxRetries then surface the last error
 *   - createExtraction forwards the Idempotency-Key header
 *   - list endpoint serializes query params
 */

import { describe, it, expect, vi } from 'vitest';
import { ResemblioClient, ResemblioApiError } from '../src/client.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('ResemblioClient', () => {
  it('throws when constructed without an API key', () => {
    expect(() => new ResemblioClient({ apiKey: '' })).toThrow(/apiKey is required/);
  });

  it('attaches the Bearer header on every request', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { items: [], schema_version: 2 }),
    );
    const client = new ResemblioClient({ apiKey: 'rsmb_test_xyz', fetchImpl });
    await client.listExtractions();
    const [, init] = fetchImpl.mock.calls[0]!;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer rsmb_test_xyz');
  });

  it('surfaces 4xx responses as ResemblioApiError without retrying', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(402, { error: 'insufficient_credit', balance_cents: 0, required_cents: 500 }),
    );
    const client = new ResemblioClient({ apiKey: 'rsmb_test_xyz', fetchImpl, maxRetries: 3 });
    await expect(client.createExtraction({ url: 'https://example.com' })).rejects.toBeInstanceOf(
      ResemblioApiError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries 5xx responses up to maxRetries', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(503, { error: 'unavailable' }));
    const client = new ResemblioClient({
      apiKey: 'rsmb_test_xyz',
      fetchImpl,
      maxRetries: 2,
      backoffMs: 1,
    });
    await expect(client.listExtractions()).rejects.toBeInstanceOf(ResemblioApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('forwards Idempotency-Key on createExtraction', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        id: 1,
        status: 'ok',
        tokens: null,
        dtcg: null,
        download_url: null,
        schema_version: 2,
        tokens_url: null,
        manifest: null,
      }),
    );
    const client = new ResemblioClient({ apiKey: 'rsmb_test_xyz', fetchImpl });
    await client.createExtraction({ url: 'https://example.com' }, 'idem-key-123');
    const [, init] = fetchImpl.mock.calls[0]!;
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('idem-key-123');
  });

  it('serializes limit + before on listExtractions', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { items: [], schema_version: 2 }));
    const client = new ResemblioClient({ apiKey: 'rsmb_test_xyz', fetchImpl });
    await client.listExtractions({ limit: 10, before: 42 });
    const [url] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toContain('limit=10');
    expect(String(url)).toContain('before=42');
  });
});

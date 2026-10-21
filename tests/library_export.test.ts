/** Tests exact DTCG transport through the TypeScript MCP server. */

import { readFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';

import {
  APPLE_LIBRARY_EXPORT_PATH,
  ResemblioApiError,
  ResemblioClient,
  validateDesignTokensBytes,
} from '../src/client.js';
import { buildServer } from '../src/index.js';
import {
  getLibraryExportTool,
  runGetLibraryExport,
  validateLibraryExportInput,
} from '../src/tools/get_library_export.js';

const MEDIA_TYPE = 'application/design-tokens+json';

async function fixture(): Promise<string> {
  return readFile(new URL('./fixtures/design.tokens.json', import.meta.url), 'utf8');
}

function response(status: number, body: string, contentType = MEDIA_TYPE): Response {
  return new Response(body, { status, headers: { 'content-type': contentType } });
}

async function callProtocol(client: ResemblioClient, args: Record<string, unknown>) {
  const server = buildServer(client);
  const protocolClient = new Client({ name: 'dtcg-test', version: '1.0.0' }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await protocolClient.connect(clientTransport);
  try {
    return await protocolClient.callTool({ name: getLibraryExportTool.name, arguments: args });
  } finally {
    await protocolClient.close();
    await server.close();
  }
}

describe('resemblio_get_library_export', () => {
  it('advertises and enforces one no-input action', async () => {
    const expected = JSON.parse(await readFile(new URL('./fixtures/library-export-input-schema.json', import.meta.url), 'utf8'));
    expect(getLibraryExportTool.inputSchema).toEqual(expected);
    expect(validateLibraryExportInput({})).toEqual({});
    expect(() => validateLibraryExportInput({ selection: 'complete' })).toThrow('does not accept arguments');
  });

  it('preserves strict UTF-8 bytes and a pure DTCG root without reserialization', async () => {
    const body = await fixture();
    const fetchImpl = vi.fn().mockResolvedValue(response(200, body));
    const result = await runGetLibraryExport(new ResemblioClient({ apiKey: 'rsmb_test', fetchImpl }), {});
    expect(result).toBe(body);
    expect(result.endsWith('\n')).toBe(true);
    expect(result).toContain('Café Sans');
    const request = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(request.pathname).toBe(APPLE_LIBRARY_EXPORT_PATH);
    expect(request.search).toBe('');
    expect((fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>).Accept).toBe(MEDIA_TYPE);
  });

  it('returns the exact API text as the sole MCP TextContent block', async () => {
    const body = await fixture();
    const result = await callProtocol(
      new ResemblioClient({ apiKey: 'rsmb_test', fetchImpl: vi.fn().mockResolvedValue(response(200, body)) }),
      {},
    );
    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: body }]);
    expect('structuredContent' in result).toBe(false);
  });

  it('rejects malformed UTF-8, non-DTCG JSON, and the wrong media type', async () => {
    expect(() => validateDesignTokensBytes(new Uint8Array([0xc3, 0x28]))).toThrow('UTF-8');
    expect(() => validateDesignTokensBytes(new TextEncoder().encode('{"tokens":{}}\n'))).toThrow('pure DTCG root');
    const client = new ResemblioClient({
      apiKey: 'rsmb_test',
      fetchImpl: vi.fn().mockResolvedValue(response(200, await fixture(), 'application/json')),
    });
    await expect(client.getAppleLibraryExport()).rejects.toThrow('content type');
  });

  it('does not retry 4xx responses and retries transient 5xx responses', async () => {
    const clientError = vi.fn().mockResolvedValue(response(403, '{"error":"entitlement_required"}', 'application/json'));
    await expect(new ResemblioClient({ apiKey: 'rsmb_test', fetchImpl: clientError, maxRetries: 3 }).getAppleLibraryExport())
      .rejects.toBeInstanceOf(ResemblioApiError);
    expect(clientError).toHaveBeenCalledTimes(1);

    const transient = vi.fn().mockResolvedValue(response(503, '{"error":"unavailable"}', 'application/json'));
    await expect(new ResemblioClient({ apiKey: 'rsmb_test', fetchImpl: transient, maxRetries: 2, backoffMs: 1 }).getAppleLibraryExport())
      .rejects.toBeInstanceOf(ResemblioApiError);
    expect(transient).toHaveBeenCalledTimes(3);
  });
});

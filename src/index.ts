#!/usr/bin/env node
/**
 * Resemblio MCP server entrypoint.
 *
 * Advertises two tools (`resemblio_extract`, `resemblio_list_extractions`)
 * over stdio per the MCP spec. Auth is provided at process start via the
 * `RESEMBLIO_API_KEY` environment variable or the `--api-key <value>`
 * command-line flag.
 *
 * Configuration:
 *   - RESEMBLIO_API_KEY   (required unless --api-key passed)
 *   - RESEMBLIO_BASE_URL  (optional; defaults to https://api.resemblio.com)
 *
 * Run:
 *   resemblio-mcp-server                    # uses env vars
 *   resemblio-mcp-server --api-key rsmb_... # explicit
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { ResemblioClient } from './client.js';
import { extractTool, runExtract, type ExtractToolInput } from './tools/extract.js';
import {
  listExtractionsTool,
  runListExtractions,
  type ListExtractionsInput,
} from './tools/list_extractions.js';

/**
 * Parse `--api-key` and `--base-url` flags from argv. Returns an empty
 * object when neither is set; env vars then take precedence in
 * `resolveConfig`.
 */
export function parseArgs(argv: readonly string[]): { apiKey?: string; baseUrl?: string } {
  const out: { apiKey?: string; baseUrl?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--api-key' && i + 1 < argv.length) {
      out.apiKey = argv[i + 1];
      i++;
    } else if (arg === '--base-url' && i + 1 < argv.length) {
      out.baseUrl = argv[i + 1];
      i++;
    }
  }
  return out;
}

/**
 * Resolve runtime configuration from argv + env. CLI flag wins over env
 * for the same field. Returns the resolved tuple or throws if no API key
 * was supplied anywhere.
 */
export function resolveConfig(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): { apiKey: string; baseUrl: string | undefined } {
  const parsed = parseArgs(argv);
  const apiKey = parsed.apiKey ?? env.RESEMBLIO_API_KEY;
  const baseUrl = parsed.baseUrl ?? env.RESEMBLIO_BASE_URL;
  if (!apiKey || apiKey.trim() === '') {
    throw new Error(
      'Resemblio MCP: no API key found. Set RESEMBLIO_API_KEY or pass --api-key <key>.',
    );
  }
  return { apiKey, baseUrl };
}

/**
 * Build the configured MCP server. Pure: returns a Server instance with
 * the two tool handlers wired to the provided client. Used by both the
 * stdio entrypoint and the smoke test.
 */
export function buildServer(client: ResemblioClient): Server {
  const server = new Server(
    { name: 'resemblio-mcp-server', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [extractTool, listExtractionsTool],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      if (name === extractTool.name) {
        const output = await runExtract(client, (args ?? {}) as unknown as ExtractToolInput);
        return { content: [{ type: 'text', text: JSON.stringify(output, null, 2) }] };
      }
      if (name === listExtractionsTool.name) {
        const output = await runListExtractions(client, (args ?? {}) as unknown as ListExtractionsInput);
        return { content: [{ type: 'text', text: JSON.stringify(output, null, 2) }] };
      }
      return {
        isError: true,
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { isError: true, content: [{ type: 'text', text: message }] };
    }
  });

  return server;
}

/**
 * Production entrypoint. Wires the server to stdio and runs forever.
 * Called only when this module is executed (not when imported by tests).
 */
async function main(): Promise<void> {
  const { apiKey, baseUrl } = resolveConfig(process.argv.slice(2), process.env);
  const client = new ResemblioClient({ apiKey, baseUrl });
  const server = buildServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server runs until the transport closes (parent process exit).
}

// Run only when invoked directly, not when imported by the test harness.
const isDirectRun =
  // import.meta.url comparison: this file is the program entrypoint when
  // the resolved URL of import.meta matches argv[1].
  import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` ||
  process.argv[1]?.endsWith('index.js') === true;
if (isDirectRun) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}

/**
 * MCP tool: `resemblio_extract`.
 *
 * Wraps POST /v1/extractions. Synchronous from the caller's perspective:
 * the v1 API runs extraction inline, so the tool returns the full
 * manifest envelope plus a small summary block on success.
 *
 * Charges the user's account per the pricing table in
 * `projects/Resemblio/CLAUDE.md > Pricing reference`. Public extraction
 * is $5; private is $10. Default is public.
 */

import type { ResemblioClient, ExtractionResponse } from '../client.js';

/**
 * JSON-Schema input shape advertised by the MCP server. Keep in sync
 * with `ExtractExtractInput`.
 */
export const extractInputSchema = {
  type: 'object',
  properties: {
    url: {
      type: 'string',
      description: 'The URL to extract a design system from. Must be a publicly reachable HTTP(S) page.',
    },
    private: {
      type: 'boolean',
      description:
        'If true, run as a private extraction ($10) - results not surfaced in the public corpus. Default false ($5 public).',
      default: false,
    },
    idempotency_key: {
      type: 'string',
      description:
        'Optional client-supplied key to make this call idempotent within the API TTL window. A retry with the same key + same body replays the original response without re-charging.',
    },
  },
  required: ['url'],
  additionalProperties: false,
} as const;

/**
 * Validated input contract for the tool handler.
 */
export interface ExtractToolInput {
  url: string;
  private?: boolean;
  idempotency_key?: string;
}

/**
 * Concise summary block included in the tool output. The full ExtractionResponse
 * is also returned so power-users can read everything; the summary is the
 * human-readable preview an assistant cites.
 */
export interface ExtractToolSummary {
  palette_color_count: number;
  font_count: number;
  has_dtcg: boolean;
  has_zip: boolean;
}

/**
 * Final tool output shape. `extraction_id`, `status`, and `manifest_url`
 * are the brief-contracted fields; the full `response` is included for
 * downstream chained tooling.
 */
export interface ExtractToolOutput {
  extraction_id: number;
  status: string;
  manifest_url: string | null;
  download_url: string | null;
  summary: ExtractToolSummary;
  schema_version: number;
  response: ExtractionResponse;
}

/**
 * Build the summary block from a successful ExtractionResponse. Pure;
 * unit-testable without network.
 */
export function summarize(response: ExtractionResponse): ExtractToolSummary {
  const tokens = response.tokens ?? {};
  const palette = (tokens['palette'] ?? tokens['colors']) as Record<string, unknown> | unknown[] | undefined;
  const fonts = (tokens['fonts'] ?? tokens['typography']) as Record<string, unknown> | unknown[] | undefined;
  return {
    palette_color_count: countEntries(palette),
    font_count: countEntries(fonts),
    has_dtcg: response.dtcg !== null && response.dtcg !== undefined,
    has_zip: response.download_url !== null && response.download_url !== undefined,
  };
}

function countEntries(value: Record<string, unknown> | unknown[] | undefined): number {
  if (value === undefined || value === null) return 0;
  if (Array.isArray(value)) return value.length;
  if (typeof value === 'object') return Object.keys(value).length;
  return 0;
}

/**
 * Tool handler. Calls the API client and reshapes the response into the
 * MCP tool contract. Errors propagate (the server-level handler turns
 * them into the MCP error envelope).
 */
export async function runExtract(
  client: ResemblioClient,
  input: ExtractToolInput,
): Promise<ExtractToolOutput> {
  const response = await client.createExtraction(
    { url: input.url, private: input.private ?? false },
    input.idempotency_key,
  );
  return {
    extraction_id: response.id,
    status: response.status,
    manifest_url: response.manifest?.tokens_url ?? response.tokens_url ?? null,
    download_url: response.download_url,
    summary: summarize(response),
    schema_version: response.schema_version,
    response,
  };
}

/**
 * MCP tool descriptor. Imported by `src/index.ts` and registered with
 * the MCP server at startup.
 */
export const extractTool = {
  name: 'resemblio_extract',
  description:
    'Extract a trademark-stripped, brand-faithful, code-bearing design system from a URL. Wordmarks, logos, and literal trademark marks are stripped; colours, type, spacing, scale, and component patterns are preserved (inspirado, no copiado). Returns DTCG tokens, a signed manifest URL, and a ZIP download URL. Charges the configured Resemblio account ($5 public / $10 private).',
  inputSchema: extractInputSchema,
} as const;

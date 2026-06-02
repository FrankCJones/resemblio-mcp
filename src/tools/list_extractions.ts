/**
 * MCP tool: `resemblio_list_extractions`.
 *
 * Wraps GET /v1/extractions. Returns paginated history for the calling
 * user. No charge; this endpoint is free.
 */

import type { ResemblioClient, ExtractionListResponse, ExtractionListItem } from '../client.js';

/**
 * JSON-Schema input shape advertised by the MCP server.
 */
export const listExtractionsInputSchema = {
  type: 'object',
  properties: {
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: 100,
      default: 20,
      description: 'Page size; bounded server-side to [1, 100].',
    },
    before: {
      type: 'integer',
      description: 'Cursor: return rows with id strictly less than this value (newest-first paging).',
    },
  },
  additionalProperties: false,
} as const;

/**
 * Validated input contract for the list-extractions handler.
 */
export interface ListExtractionsInput {
  limit?: number;
  before?: number;
}

/**
 * Tool output shape. Echoes the API envelope verbatim plus a `total`
 * hint (length of the returned page; the API does not yet expose a
 * grand total).
 */
export interface ListExtractionsOutput {
  items: ExtractionListItem[];
  schema_version: number;
  total: number;
}

/**
 * Pure reshape from API envelope to tool output. Unit-testable.
 */
export function shapeListResponse(envelope: ExtractionListResponse): ListExtractionsOutput {
  return {
    items: envelope.items,
    schema_version: envelope.schema_version,
    total: envelope.items.length,
  };
}

/**
 * Tool handler.
 */
export async function runListExtractions(
  client: ResemblioClient,
  input: ListExtractionsInput,
): Promise<ListExtractionsOutput> {
  const envelope = await client.listExtractions({
    limit: input.limit,
    before: input.before,
  });
  return shapeListResponse(envelope);
}

/**
 * MCP tool descriptor.
 */
export const listExtractionsTool = {
  name: 'resemblio_list_extractions',
  description:
    'List the calling Resemblio account\'s extraction history, newest first. Paginated via `before` cursor.',
  inputSchema: listExtractionsInputSchema,
} as const;

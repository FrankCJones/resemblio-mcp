/** MCP tool for retrieving the canonical Apple design.tokens.json document. */
import type { ResemblioClient } from '../client.js';

export type GetLibraryExportInput = Record<string, never>;

export const getLibraryExportInputSchema = {
  type: 'object',
  properties: {},
  additionalProperties: false,
} as const;

/** Reject every argument so the public tool has one deterministic action. */
export function validateLibraryExportInput(input: unknown): GetLibraryExportInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('library export input must be an object');
  }
  if (Object.keys(input).length !== 0) {
    throw new Error('library export does not accept arguments');
  }
  return {};
}

/** Fetch and return the exact decoded canonical JSON body. */
export async function runGetLibraryExport(
  client: ResemblioClient,
  input: unknown,
): Promise<string> {
  validateLibraryExportInput(input);
  return client.getAppleLibraryExport();
}

export const getLibraryExportTool = {
  name: 'resemblio_get_library_export',
  description:
    'Retrieve the canonical Apple design.tokens.json document as pure DTCG JSON. This read-only tool returns the exact API body and requires an entitled Resemblio API key.',
  inputSchema: getLibraryExportInputSchema,
} as const;

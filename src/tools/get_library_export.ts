/** MCP tool for retrieving a selected, no-cost Apple DTCG library export. */
import type { AppleLibraryExport, ResemblioClient } from '../client.js';

export type AppleLibraryExportSelection =
  | { selection: 'complete' }
  | { selection: 'classification'; classification: 'foundation' | 'component' | 'composition' }
  | { selection: 'record'; record_ids: string[] };

export type GetLibraryExportInput = AppleLibraryExportSelection;

export const getLibraryExportInputSchema = {
  type: 'object',
  oneOf: [
    { properties: { selection: { const: 'complete' } }, required: ['selection'], additionalProperties: false },
    {
      properties: {
        selection: { const: 'classification' },
        classification: { type: 'string', enum: ['foundation', 'component', 'composition'] },
      },
      required: ['selection', 'classification'],
      additionalProperties: false,
    },
    {
      properties: {
        selection: { const: 'record' },
        record_ids: { type: 'array', minItems: 1, items: { type: 'string', pattern: '^(foundation|component|composition):[a-z0-9][a-z0-9-]*$' } },
      },
      required: ['selection', 'record_ids'],
      additionalProperties: false,
    },
  ],
  additionalProperties: false,
} as const;

/** Validate a selector strictly and normalize record IDs for stable requests. */
export function normalizeLibraryExportInput(input: unknown): GetLibraryExportInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('invalid_selection');
  }
  const value = input as Record<string, unknown>;
  const fields = Object.keys(value);
  if (value.selection === 'complete') {
    if (fields.length !== 1) throw new Error('mixed_selection_contracts');
    return { selection: 'complete' };
  }
  if (value.selection === 'classification') {
    if (fields.some((field) => field !== 'selection' && field !== 'classification')) {
      throw new Error('mixed_selection_contracts');
    }
    if (fields.length !== 2 || !['foundation', 'component', 'composition'].includes(String(value.classification))) {
      throw new Error('invalid_classification');
    }
    return { selection: 'classification', classification: value.classification as 'foundation' | 'component' | 'composition' };
  }
  if (value.selection === 'record') {
    if (fields.some((field) => field !== 'selection' && field !== 'record_ids')) {
      throw new Error('mixed_selection_contracts');
    }
    if (fields.length !== 2 || !Array.isArray(value.record_ids) || value.record_ids.length === 0) {
      throw new Error('missing_records');
    }
    if (value.record_ids.some((id) => typeof id !== 'string' || !/^(foundation|component|composition):[a-z0-9][a-z0-9-]*$/.test(id))) {
      throw new Error('invalid_record_id');
    }
    return { selection: 'record', record_ids: [...new Set(value.record_ids as string[])].sort() };
  }
  throw new Error('invalid_selection');
}

/** Fetch a validated export and return the API artifact without reshaping. */
export async function runGetLibraryExport(
  client: ResemblioClient,
  input: unknown,
): Promise<AppleLibraryExport> {
  return client.getAppleLibraryExport(normalizeLibraryExportInput(input));
}

export const getLibraryExportTool = {
  name: 'resemblio_get_library_export',
  description:
    'Retrieve a complete Apple DTCG library export or a classification or record slice. This read-only tool is free and returns the API artifact unchanged. Requires an entitled Resemblio API key.',
  inputSchema: getLibraryExportInputSchema,
} as const;

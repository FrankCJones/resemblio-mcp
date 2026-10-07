/**
 * MCP tool: `resemblio_get_library_manifest`.
 *
 * This zero-input, read-only tool fetches the canonical Apple library artifact
 * from the API. It deliberately adds no MCP-specific wrapper or record map.
 */
import type { AppleSystemManifest, ResemblioClient } from '../client.js';

export const getLibraryManifestInputSchema = {
  type: 'object',
  properties: {},
  additionalProperties: false,
} as const;

export type GetLibraryManifestInput = Record<string, never>;

/** Return the API canonical artifact unchanged after client validation. */
export async function runGetLibraryManifest(
  client: ResemblioClient,
  _input: GetLibraryManifestInput = {},
): Promise<AppleSystemManifest> {
  return client.getAppleSystemManifest();
}

export const getLibraryManifestTool = {
  name: 'resemblio_get_library_manifest',
  description:
    'Retrieve the verified canonical Apple library manifest. This read-only tool is free and returns the API artifact unchanged, including its record set, facets, version, and SHA-256 digest.',
  inputSchema: getLibraryManifestInputSchema,
} as const;

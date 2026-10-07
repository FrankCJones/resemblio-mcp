/**
 * Exercise the compiled TypeScript MCP registration over an in-memory protocol.
 *
 * Run:
 *   node tests/prove_library_export_protocol.mjs input.json output.json
 */
import { readFile, writeFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ResemblioClient } from '../dist/client.js';
import { buildServer } from '../dist/index.js';

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) {
  throw new Error('Expected input and output JSON paths.');
}

const proof = JSON.parse(await readFile(inputPath, 'utf8'));
let requestIndex = 0;
const fetchImpl = async (input) => {
  const proofCase = proof.cases[requestIndex];
  if (!proofCase) {
    return new Response(JSON.stringify({ error: 'unexpected_request' }), { status: 400 });
  }
  requestIndex += 1;
  const url = new URL(String(input));
  if (url.pathname !== '/v1/apple/exports/dtcg') {
    return new Response(JSON.stringify({ error: 'unexpected_path' }), { status: 400 });
  }
  return new Response(JSON.stringify({ schema_version: 2, data: proofCase.artifact }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

const server = buildServer(new ResemblioClient({ apiKey: 'rsmb_proof', fetchImpl }));
const client = new Client(
  { name: 'resemblio-checkpoint-three-proof', version: '1.0.0' },
  { capabilities: {} },
);
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);
await client.connect(clientTransport);

const artifacts = {};
try {
  for (const proofCase of proof.cases) {
    const result = await client.callTool({
      name: 'resemblio_get_library_export',
      arguments: proofCase.arguments,
    });
    const block = result.content[0];
    if (result.isError || !block || block.type !== 'text') {
      throw new Error(`MCP protocol call failed for ${proofCase.name}.`);
    }
    artifacts[proofCase.name] = JSON.parse(block.text);
  }
} finally {
  await client.close();
  await server.close();
}

await writeFile(outputPath, `${JSON.stringify({
  schema_version: 'resemblio_typescript_mcp_protocol_proof_v1',
  artifacts,
}, null, 2)}\n`, 'utf8');

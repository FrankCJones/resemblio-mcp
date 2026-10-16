import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('resemblio-mcp-server release identity', () => {
  it('keeps the runtime server version aligned with package metadata', () => {
    const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    const entrypoint = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
    expect(entrypoint).toContain(`version: '${packageJson.version}'`);
  });
});

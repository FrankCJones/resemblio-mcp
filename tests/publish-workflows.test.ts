import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const npmWorkflow = readFileSync(
  new URL('../.github/workflows/publish.yml', import.meta.url),
  'utf8',
);
const pythonWorkflow = readFileSync(
  new URL('../.github/workflows/publish-python.yml', import.meta.url),
  'utf8',
);

describe('package publication workflows', () => {
  it.each([
    ['npm', npmWorkflow],
    ['PyPI', pythonWorkflow],
  ])('%s is tag-only and bound to an approved commit', (_name, workflow) => {
    expect(workflow).not.toContain('workflow_dispatch');
    expect(workflow).toContain('RESEMBLIO_MCP_RELEASE_SHA');
    expect(workflow).toContain('Release SHA is not approved');
  });

  it('requires the npm tag to match package.json', () => {
    expect(npmWorkflow).toContain("require('./package.json').version");
    expect(npmWorkflow).toContain('Tag does not match package version');
  });

  it('requires the PyPI tag to match pyproject.toml', () => {
    expect(pythonWorkflow).toContain("tomllib.load(open('python/pyproject.toml', 'rb'))");
    expect(pythonWorkflow).toContain('Tag does not match Python package version');
  });
});

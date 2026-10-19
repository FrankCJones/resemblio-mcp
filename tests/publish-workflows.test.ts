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

  it('uses an npm-specific tag that matches package.json', () => {
    expect(npmWorkflow).toContain("- 'npm-v*.*.*'");
    expect(npmWorkflow).toContain("require('./package.json').version");
    expect(npmWorkflow).toContain('npm-v${PACKAGE_VERSION}');
    expect(npmWorkflow).toContain('Tag does not match package version');
  });

  it('uses tokenless npm trusted publishing', () => {
    expect(npmWorkflow).not.toContain('NODE_AUTH_TOKEN');
    expect(npmWorkflow).not.toContain('RESEMBLIO_NPM_BOOTSTRAP_TOKEN');
    expect(npmWorkflow).toContain("node-version: '24'");
    expect(npmWorkflow).toContain('npm install -g npm@latest');
    expect(npmWorkflow).toContain('Publish through npm trusted publishing');
  });

  it('keeps package inspection and trusted-publishing controls', () => {
    expect(npmWorkflow).toContain('environment: npm-publish');
    expect(npmWorkflow).toContain('id-token: write');
    expect(npmWorkflow).toContain('npm_config_dry_run=true npm pack');
    expect(npmWorkflow).toContain('run: npm publish');
  });

  it('requires the PyPI tag to match pyproject.toml', () => {
    expect(pythonWorkflow).toContain("tomllib.load(open('python/pyproject.toml', 'rb'))");
    expect(pythonWorkflow).toContain('Tag does not match Python package version');
  });
});

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

  it('limits the npm bootstrap to version 0.2.0', () => {
    expect(npmWorkflow).toContain("BOOTSTRAP_VERSION: '0.2.0'");
    expect(npmWorkflow).toContain('Bootstrap version mismatch');
  });

  it('exposes the temporary npm credential only to the publish step', () => {
    const publishStepMarker = '- name: Publish bootstrap release';
    const [beforePublish, publishStep] = npmWorkflow.split(publishStepMarker);

    expect(beforePublish).not.toContain('NODE_AUTH_TOKEN');
    expect(publishStep).toContain(
      'NODE_AUTH_TOKEN: ${{ secrets.RESEMBLIO_NPM_BOOTSTRAP_TOKEN }}',
    );
    expect(publishStep).toContain('Missing npm bootstrap token');
  });

  it('keeps the bootstrap package inspection and provenance controls', () => {
    expect(npmWorkflow).toContain('environment: npm-publish');
    expect(npmWorkflow).toContain('id-token: write');
    expect(npmWorkflow).toContain('npm pack --dry-run');
    expect(npmWorkflow).toContain('npm publish --provenance --access public');
  });

  it('requires the PyPI tag to match pyproject.toml', () => {
    expect(pythonWorkflow).toContain("tomllib.load(open('python/pyproject.toml', 'rb'))");
    expect(pythonWorkflow).toContain('Tag does not match Python package version');
  });
});

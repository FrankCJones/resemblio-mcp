# MCP Release Fixtures

These repository-local fixtures keep TypeScript and Python release tests independent of sibling workspace checkouts.

## Files

- `apple-system-manifest.json` is the exact public Apple manifest from reviewed API commit `afa18c7931350d9fb306b2d66384683755c9d96a`.
- `library-export-artifacts.json` contains the five exact API export selections consumed by protocol tests.
- `library-export-input-schema.json` is the shared TypeScript and Python selector contract.
- `fixture-provenance.json` pins source identity and byte hashes for release validation.

Git attributes pin every JSON fixture to LF. Provenance checks normalize a local CRLF checkout back to LF before hashing so the committed byte identity remains stable across operating systems.

## Data flow

The MCP clients consume API responses unchanged. Tests load these fixtures, wrap them in offline HTTP responses, and prove both implementations preserve the same response shapes, selectors, hashes, and record identities.

The maintenance generator accepts an explicit reviewed API checkout path. It is not part of normal release tests because the MCP repository must remain independently testable. After intentional regeneration, update `fixture-provenance.json` from reviewed source bytes before committing.

## Contract

Release tests must pass from a clean checkout containing only this repository. They must not resolve fixtures or Python modules through a parent workspace path. Fixture hashes and the reviewed API source commit are required provenance.

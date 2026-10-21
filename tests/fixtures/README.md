# MCP Release Fixtures

These repository-local fixtures keep TypeScript and Python release tests independent of sibling workspace checkouts.

## Files

- `apple-system-manifest.json` is the exact public Apple manifest from reviewed API commit `afa18c7931350d9fb306b2d66384683755c9d96a`.
- `design.tokens.json` is the shared exact-byte DTCG transport fixture, including UTF-8 text and a terminal line feed.
- `library-export-artifacts.json` is the retained pre-0.3.0 selector fixture used only for provenance history.
- `library-export-input-schema.json` is the shared TypeScript and Python no-input contract.
- `fixture-provenance.json` pins source identity and byte hashes for release validation.

Git attributes pin every JSON fixture to LF. Provenance checks normalize a local CRLF checkout back to LF before hashing so the committed byte identity remains stable across operating systems.

## Data flow

The MCP clients consume the DTCG response bytes unchanged. Tests load the shared token fixture, wrap it in offline HTTP responses, and prove both implementations preserve the same text through the registered protocol tool.

The maintenance generator accepts an explicit reviewed API checkout path. It is not part of normal release tests because the MCP repository must remain independently testable. After intentional regeneration, update `fixture-provenance.json` from reviewed source bytes before committing.

## Contract

Release tests must pass from a clean checkout containing only this repository. They must not resolve fixtures or Python modules through a parent workspace path. Fixture hashes and the reviewed API source commit are required provenance.

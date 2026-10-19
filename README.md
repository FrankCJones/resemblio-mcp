# @resemblio/mcp-server

Model Context Protocol server for [Resemblio](https://resemblio.com). Lets MCP-compatible clients (Claude Desktop, Claude Code, Cursor, Codex CLI) extract trademark-stripped, brand-faithful, code-bearing design systems from any URL. Inspired by the source, not a copy of it (_inspirado, no copiado_).

## Install

```bash
npm install -g @resemblio/mcp-server
```

## Configure

Set your API key (get one at https://resemblio.com):

```bash
export RESEMBLIO_API_KEY=rsmb_live_<your-key>
```

### Claude Desktop

Edit `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`; Windows: `%APPDATA%\Claude\claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "resemblio": {
      "command": "resemblio-mcp-server",
      "env": {
        "RESEMBLIO_API_KEY": "rsmb_live_<your-key>"
      }
    }
  }
}
```

### Cursor

Edit `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "resemblio": {
      "command": "resemblio-mcp-server",
      "env": {
        "RESEMBLIO_API_KEY": "rsmb_live_<your-key>"
      }
    }
  }
}
```

### Claude Code (CLI)

```bash
claude mcp add resemblio resemblio-mcp-server -e RESEMBLIO_API_KEY=rsmb_live_<your-key>
```

## Tools exposed

### `resemblio_extract`

Extract a trademark-stripped, brand-faithful design system from a URL. Wordmarks, logos, and literal trademark marks are stripped; colours, type, spacing, scale, and component patterns are preserved as a code-bearing starting point. Returns a DTCG-compatible token JSON, a signed manifest URL, and a download URL for the full ZIP bundle.

Input:
- `url` (string, required): the page to extract from
- `private` (boolean, optional): if true, run as private extraction ($10); default false ($5)
- `idempotency_key` (string, optional): client-supplied key for replay-safe retries

Charges your Resemblio account on success. Failures that are Resemblio's fault are automatically refunded.

### `resemblio_list_extractions`

List your extraction history, newest first.

Input:
- `limit` (integer, optional): page size, 1-100, default 20
- `before` (integer, optional): cursor; return rows with id less than this value

No charge.

### `resemblio_get_library_manifest`

Retrieve the verified canonical Apple library manifest. This no-input, read-only tool is free and returns the API artifact unchanged, including its record set, classification-specific facets, version, and SHA-256 digest.

### `resemblio_get_library_export`

Retrieve a no-cost Apple DTCG export. Requires an entitled Resemblio API key.
The tool returns the API's two named values unchanged: `tokens` is the pure
DTCG document, and `manifest` carries selection, provenance, attribution,
scrub policy, version, and the SHA-256 identity for
`tokens/design.tokens.json`.

Input uses one selector:
- `{ "selection": "complete" }`
- `{ "selection": "classification", "classification": "foundation" | "component" | "composition" }`
- `{ "selection": "record", "record_ids": ["component:buttons"] }` (one or more canonical record IDs)

Record IDs are deduplicated and sorted before the API request. Invalid selectors fail closed; the API's stable selection errors are preserved.

## Configuration reference

| Env var | Required | Default | Description |
|---|---|---|---|
| `RESEMBLIO_API_KEY` | yes | - | API key (starts with `rsmb_live_` or `rsmb_test_`) |
| `RESEMBLIO_BASE_URL` | no | `https://api.resemblio.com` | Override the API host (for local testing) |

Equivalent CLI flags: `--api-key`, `--base-url`.

## Development

Development requires Node.js 20 or newer. The published server runtime supports Node.js 18.14.1 or newer.

```bash
npm install
npm run typecheck
npm test
npm run build
```

## License

MIT. Copyright (c) 2026 Frank Jones / OptSus.

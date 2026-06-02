# resemblio-mcp

Model Context Protocol server for [Resemblio](https://resemblio.com), Python edition. Lets MCP-compatible clients (Claude Desktop, Claude Code, Cursor, Codex CLI) extract brand-stripped, code-bearing design systems from any URL.

## Install

```bash
pip install resemblio-mcp
# or
pipx install resemblio-mcp
```

## Configure

Set your API key (get one at https://resemblio.com):

```bash
export RESEMBLIO_API_KEY=rsmb_live_xxxxxxxxxxxx
```

### Claude Desktop

Edit `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`; Windows: `%APPDATA%\Claude\claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "resemblio": {
      "command": "resemblio-mcp",
      "env": {
        "RESEMBLIO_API_KEY": "rsmb_live_xxxxxxxxxxxx"
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
      "command": "resemblio-mcp",
      "env": {
        "RESEMBLIO_API_KEY": "rsmb_live_xxxxxxxxxxxx"
      }
    }
  }
}
```

### Claude Code (CLI)

```bash
claude mcp add resemblio resemblio-mcp -e RESEMBLIO_API_KEY=rsmb_live_xxxxxxxxxxxx
```

## Tools exposed

Identical contract to the TypeScript package `@resemblio/mcp-server`.

### `resemblio_extract`

Extract a brand-stripped design system from a URL. Returns a DTCG-compatible token JSON, a signed manifest URL, and a download URL for the full ZIP bundle.

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

## Configuration reference

| Env var | Required | Default | Description |
|---|---|---|---|
| `RESEMBLIO_API_KEY` | yes | - | API key (starts with `rsmb_live_` or `rsmb_test_`) |
| `RESEMBLIO_BASE_URL` | no | `https://api.resemblio.com` | Override the API host (for local testing) |

Equivalent CLI flags: `--api-key`, `--base-url`.

## Development

```bash
pip install -e ".[dev]"
pytest
```

## License

MIT. Copyright (c) 2026 Frank Jones / OptSus.

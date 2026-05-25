# @resemblio/mcp-server

Model Context Protocol server for [Resemblio](https://resemblio.com). Lets MCP-compatible clients (Claude Code, Cursor, Codex CLI) extract brand-stripped, code-bearing design systems from any URL.

## Status

Pre-release. Initial scaffold; the MCP tool surface lands when the Resemblio v1.1 API ships.

## Install

```bash
npm install -g @resemblio/mcp-server
```

## Configure

Add to your MCP client config (example for Claude Code at `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "resemblio": {
      "command": "resemblio-mcp-server",
      "env": {
        "RESEMBLIO_API_KEY": "rsmb_live_..."
      }
    }
  }
}
```

Get an API key by signing up at https://resemblio.com.

## Tools exposed

Tools land when the v1.1 API ships. Planned:

- `resemblio_extract` - extract design tokens from a URL; returns DTCG JSON + download URL for the ZIP bundle
- `resemblio_list_extractions` - list your extraction history
- `resemblio_get_extraction` - fetch a previously-completed extraction by id

## License

MIT

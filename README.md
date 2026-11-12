# galaxymovies-mcp

MCP server for [Galaxy Movies](https://www.galaxymovies.app) — gives Claude Desktop, Cursor, Windsurf, and other MCP clients structured access to US streaming availability data: what's arriving, what's leaving, and where a title streams.

No API keys. The tools call Galaxy Movies' public, CORS-open feeds.

## Install

```json
{
  "mcpServers": {
    "galaxymovies": {
      "command": "npx",
      "args": ["-y", "galaxymovies-mcp"]
    }
  }
}
```

Same shape works for Claude Desktop (`claude_desktop_config.json`), Cursor, Windsurf, and other stdio clients. Requires Node.js ≥ 18.

## Tools

| Tool | Params | What it returns |
|---|---|---|
| `list_providers` | — | The ~20 tracked US services (keys + labels) |
| `get_streaming_changes` | `provider` (key or `all`) | `added`, `coming`, `left`, `leavingSoon` arrays per service |
| `get_arrivals` | `provider`, `limit?` | `added` + `coming` only |
| `get_departures` | `provider`, `limit?` | `left` + `leavingSoon` only |
| `where_to_watch` | `query`, `year?`, `region?`, `type?` | Services streaming the title (subscription / free / ads / rent / buy) |
| `calendar_feed_url` | `provider` | ICS feed URL — subscribable in any calendar app |
| `rss_feed_url` | `provider` | RSS feed URL |

Example prompts once installed:

- "What's leaving Netflix this month?"
- "Where can I stream Fight Club?"
- "Give me an RSS feed for new Disney+ releases."

## Attribution

Data is free to use under the [Galaxy Movies API terms](https://www.galaxymovies.app/llms.txt): keep the "Powered by Galaxy Movies" attribution when republishing.

## Development

```
npm install
node index.js        # stdio server — pair with an MCP client or inspector
npx @modelcontextprotocol/inspector node index.js
```

## License

MIT — see [LICENSE](LICENSE).

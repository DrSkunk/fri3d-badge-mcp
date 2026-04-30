# fri3d-badge-mcp

A [Model Context Protocol](https://modelcontextprotocol.io/) server that gives
LLM clients structured access to **MicroPython** documentation and the
**Fri3d Camp 2026 badge** documentation.

It can run **locally as a stdio MCP server** (via `npx`) or be deployed to
**Vercel** as an HTTP MCP endpoint using the
[`mcp-handler`](https://www.npmjs.com/package/mcp-handler) package.

## Sources

- MicroPython official docs — <https://docs.micropython.org/en/latest/>
  (Sphinx site; we use its `searchindex.js` for keyword search and scrape
  individual pages for content.)
- MicroPythonOS docs — <https://docs.micropythonos.com/>
  (MkDocs Material site; pages and sections discovered via
  `search/search_index.json`.)
- Fri3d Camp 2026 badge — <https://fri3dcamp.github.io/badge_2026/>
  (MkDocs Material site; pages and sections discovered via
  `search/search_index.json`.)

Nothing is bundled or pre-indexed — everything is fetched on demand and cached
in memory and on disk so the server stays current with upstream docs without
redeploys.

## Tools exposed

| Tool | Description |
| ---- | ----------- |
| `search_micropython_docs` | Keyword search across the MicroPython docs (Sphinx index). |
| `get_micropython_page` | Fetch & clean a MicroPython doc page (path or full URL). |
| `list_micropython_modules` | Curated list of common MicroPython modules + quick-references. |
| `search_fri3d_badge_docs` | Substring search across all Fri3d badge_2026 pages. |
| `get_fri3d_badge_page` | Fetch & clean a Fri3d badge_2026 page. |
| `list_fri3d_badge_pages` | List all known Fri3d badge_2026 pages and sections. |
| `search_micropythonos_docs` | Substring search across all MicroPythonOS docs pages. |
| `get_micropythonos_page` | Fetch & clean a MicroPythonOS docs page. |
| `list_micropythonos_pages` | List all known MicroPythonOS docs pages and sections. |

All tools return `text` content suitable for direct consumption by an LLM.

## Local usage via npx (stdio transport)

The easiest way to use this MCP server locally is via `npx`. Add it to your
MCP client configuration (e.g. Claude Desktop `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "fri3d-badge": {
      "command": "npx",
      "args": ["fri3d-badge-mcp"]
    }
  }
}
```

Or start it manually to test:

```bash
npx fri3d-badge-mcp
```

### Caching

The local server caches all fetched search indices and pages using a two-layer
strategy:

| Layer | Scope | TTL |
|-------|-------|-----|
| In-memory | current process | 15 min – 1 h |
| Disk (`os.tmpdir()/fri3d-badge-mcp/`) | survives restarts | same TTL |

**Stale-while-revalidate**: when the disk cache has data older than its TTL
(but less than 2× TTL), the server returns the stale data immediately while
refreshing in the background, so the next call already gets fresh results.
Data older than 2× TTL is always re-fetched synchronously.

## Architecture

```
api/
  server.ts            # Vercel MCP handler — wires tools to source modules
src/
  server.ts            # Standalone stdio MCP server (npx entry point)
  tools.ts             # Shared tool registrations (used by both transports)
  lib/
    cache.ts           # TTL cache with disk persistence + stale-while-revalidate
    fetch.ts           # fetch() wrapper with timeout + UA
    html.ts            # Lightweight HTML → markdown-ish text extractor
  sources/
    micropython.ts     # MicroPython search + page fetch
    fri3d.ts           # Fri3d badge docs search + page fetch
    micropythonos.ts   # MicroPythonOS docs search + page fetch
scripts/
  test-client.mjs      # Sample MCP client for local smoke testing
vercel.json            # Routes everything to /api/server, 60s max duration
```

## Deploy on Vercel

1. Push this repo to GitHub.
2. Import it on Vercel and deploy. No env vars required.
3. Enable [Fluid compute](https://vercel.com/docs/functions/fluid-compute) for
   better warm-start reuse of the in-memory cache.
4. (Pro/Enterprise) bump `vercel.json` `maxDuration` to `800` if you want long
   searches to never time out.

The MCP endpoint is then:

```
https://<your-deployment>.vercel.app/mcp
```

Uses streamable-HTTP transport only (the current MCP spec).

## Local development (Vercel dev server)

```bash
npm install
npm start            # runs `vercel dev` on http://localhost:3000
node scripts/test-client.mjs http://localhost:3000
```

## Notes & limitations

- The MicroPython search uses Sphinx's `searchindex.js`, which contains
  stemmed tokens. The implementation does prefix matching plus title/object
  weighting; it is intentionally simple but covers typical lookups
  (`machine.Pin`, `interrupt`, `neopixel`, `wifi`, …).
- The Fri3d badge_2026 and MicroPythonOS sources both use MkDocs Material's
  `search/search_index.json` and currently perform weighted substring matching
  over title and body text.
- Page fetches are restricted to the documentation hostnames as a small SSRF
  guard.

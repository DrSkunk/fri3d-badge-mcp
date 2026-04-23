# fri3d-badge-mcp

A [Model Context Protocol](https://modelcontextprotocol.io/) server that gives
LLM clients structured access to **MicroPython** documentation and the
**Fri3d Camp 2026 badge** documentation.

It is built as a single Vercel Function using the
[`mcp-handler`](https://www.npmjs.com/package/mcp-handler) package and is meant
to be deployed with the
[MCP with Vercel Functions](https://vercel.com/templates/other/model-context-protocol-mcp-with-vercel-functions)
template.

## Sources

- MicroPython official docs — <https://docs.micropython.org/en/latest/>
  (Sphinx site; we use its `searchindex.js` for keyword search and scrape
  individual pages for content.)
- Fri3d Camp 2026 badge — <https://fri3dcamp.github.io/badge_2026/>
  (MkDocs Material site; pages discovered via `sitemap.xml`.)

Nothing is bundled or pre-indexed — everything is fetched on demand and cached
in-memory per warm function instance, so the server stays current with upstream
docs without redeploys.

## Tools exposed

| Tool | Description |
| ---- | ----------- |
| `search_micropython_docs` | Keyword search across the MicroPython docs (Sphinx index). |
| `get_micropython_page` | Fetch & clean a MicroPython doc page (path or full URL). |
| `list_micropython_modules` | Curated list of common MicroPython modules + quick-references. |
| `search_fri3d_badge_docs` | Substring search across all Fri3d badge_2026 pages. |
| `get_fri3d_badge_page` | Fetch & clean a Fri3d badge_2026 page. |
| `list_fri3d_badge_pages` | List all known Fri3d badge_2026 pages from the sitemap. |

All tools return `text` content suitable for direct consumption by an LLM.

## Architecture

```
api/
  server.ts            # MCP handler — wires zod-validated tools to source modules
src/
  lib/
    cache.ts           # Tiny in-memory TTL cache (warm-instance reuse)
    fetch.ts           # fetch() wrapper with timeout + UA
    html.ts            # Lightweight HTML → markdown-ish text extractor
  sources/
    micropython.ts     # MicroPython search + page fetch
    fri3d.ts           # Fri3d badge sitemap + search + page fetch
scripts/
  test-client.mjs      # Sample MCP client for local smoke testing
vercel.json            # Routes everything to /api/server, 60s max duration
```

The Vercel deployment is **stateless** — each cold invocation can re-fetch
indexes; warm invocations reuse the in-process cache (TTLs of 15–60 minutes).

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

Uses the streamable-HTTP transport (the current MCP spec). The legacy SSE
transport is intentionally disabled so the server has **no Redis dependency**.

## Local development

```bash
pnpm install         # or npm install
npm start            # runs `vercel dev` on http://localhost:3000
node scripts/test-client.mjs http://localhost:3000
```

Or wire it into an MCP-compatible client (Claude Desktop, Cursor, VS Code,
etc.) by pointing at `http://localhost:3000/mcp`.

## Notes & limitations

- The MicroPython search uses Sphinx's `searchindex.js`, which contains
  stemmed tokens. The implementation does prefix matching plus title/object
  weighting; it is intentionally simple but covers typical lookups
  (`machine.Pin`, `interrupt`, `neopixel`, `wifi`, …).
- The Fri3d badge_2026 site is small at the moment, so search just substring-
  matches all discovered pages. As the site grows, swap in MkDocs Material's
  `search/search_index.json` for better results.
- Page fetches are restricted to the documentation hostnames as a small SSRF
  guard.

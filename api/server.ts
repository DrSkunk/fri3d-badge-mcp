import { createMcpHandler } from "mcp-handler";
import { z } from "zod";

import {
  MICROPYTHON_COMMON_MODULES,
  getMicropythonPage,
  searchMicropythonDocs,
} from "../src/sources/micropython.js";
import {
  getFri3dPage,
  listFri3dPages,
  searchFri3dDocs,
} from "../src/sources/fri3d.js";
import {
  getMicropythonOSPage,
  listMicropythonOSPages,
  searchMicropythonOSDocs,
} from "../src/sources/micropythonos.js";

const handler = createMcpHandler((server) => {
  // ---------------------------------------------------------------------------
  // MicroPython
  // ---------------------------------------------------------------------------

  server.tool(
    "search_micropython_docs",
    "Search the official MicroPython documentation (docs.micropython.org). " +
      "Returns ranked pages with title, path and URL. Use `get_micropython_page` to read full content.",
    {
      query: z.string().min(1).describe("Free-text search, e.g. 'machine.Pin interrupt' or 'neopixel'."),
      limit: z.number().int().min(1).max(50).optional().describe("Max number of results (default 10)."),
      version: z
        .string()
        .optional()
        .describe("Docs version, e.g. 'latest', 'v1.22'. Defaults to 'latest'."),
    },
    async ({ query, limit, version }) => {
      const hits = await searchMicropythonDocs(query, { limit, version });
      if (hits.length === 0) {
        return {
          content: [{ type: "text", text: `No MicroPython docs match "${query}".` }],
        };
      }
      const lines = hits.map((h, i) => {
        const head = `${i + 1}. ${h.title}${h.symbol ? ` — ${h.symbol}` : ""}`;
        const meta = `   path:   ${h.path}${h.anchor ? ` (#${h.anchor})` : ""}\n   url:    ${h.url}\n   score:  ${h.score} (matched: ${h.matchedTerms.join(", ")})`;
        return `${head}\n${meta}`;
      });
      return {
        content: [
          {
            type: "text",
            text: `Top ${hits.length} MicroPython docs results for "${query}":\n\n${lines.join("\n\n")}`,
          },
        ],
      };
    },
  );

  server.tool(
    "get_micropython_page",
    "Fetch a MicroPython documentation page and return its cleaned text content. " +
      "Accepts a path like 'library/machine.Pin' or a full docs.micropython.org URL. " +
      "Pass `section` (or include a #anchor in the URL) to return only that section, which is much smaller.",
    {
      path: z.string().min(1).describe("Page path or docs.micropython.org URL."),
      section: z
        .string()
        .optional()
        .describe("Section anchor (without the leading #) to extract just that section."),
      maxChars: z.number().int().min(500).max(200_000).optional().describe("Max chars (default 60000)."),
      version: z.string().optional().describe("Docs version (default 'latest')."),
    },
    async ({ path, section, maxChars, version }) => {
      const page = await getMicropythonPage(path, { maxChars, version, section });
      return {
        content: [
          {
            type: "text",
            text: `# ${page.title}\nSource: ${page.url}${page.truncated ? "\n(content truncated)" : ""}\n\n${page.content}`,
          },
        ],
      };
    },
  );

  server.tool(
    "list_micropython_modules",
    "List a curated set of frequently-used MicroPython modules and quick-reference pages, " +
      "with their docs paths.",
    {},
    async () => {
      const lines = MICROPYTHON_COMMON_MODULES.map(
        (m) => `- ${m.module} → ${m.path}\n  ${m.description}`,
      );
      return {
        content: [
          {
            type: "text",
            text: `Common MicroPython modules / pages:\n\n${lines.join("\n")}`,
          },
        ],
      };
    },
  );

  // ---------------------------------------------------------------------------
  // Fri3d Camp 2026 badge
  // ---------------------------------------------------------------------------

  server.tool(
    "search_fri3d_badge_docs",
    "Search the Fri3d Camp 2026 badge documentation (fri3dcamp.github.io/badge_2026). " +
      "Returns ranked pages with a snippet around the match.",
    {
      query: z.string().min(1).describe("Free-text search query."),
      limit: z.number().int().min(1).max(25).optional().describe("Max results (default 10)."),
      lang: z.enum(["nl", "en", "all"]).optional().describe("Restrict to a language (default 'all')."),
    },
    async ({ query, limit, lang }) => {
      const hits = await searchFri3dDocs(query, { limit, lang });
      if (hits.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No Fri3d badge_2026 pages match "${query}". The site is small and may not yet contain this topic — try \`list_fri3d_badge_pages\`.`,
            },
          ],
        };
      }
      const lines = hits.map(
        (h, i) =>
          `${i + 1}. ${h.title} [${h.lang}]\n   url:   ${h.url}\n   score: ${h.score}\n   …${h.snippet}…`,
      );
      return {
        content: [
          { type: "text", text: `Fri3d badge_2026 results for "${query}":\n\n${lines.join("\n\n")}` },
        ],
      };
    },
  );

  server.tool(
    "get_fri3d_badge_page",
    "Fetch a Fri3d Camp 2026 badge documentation page and return its cleaned text content. " +
      "Accepts a path like 'en/' or a full fri3dcamp.github.io/badge_2026 URL.",
    {
      path: z.string().min(1).describe("Page path or full URL on the badge_2026 site."),
      maxChars: z.number().int().min(500).max(200_000).optional().describe("Max chars (default 40000)."),
    },
    async ({ path, maxChars }) => {
      const page = await getFri3dPage(path, { maxChars });
      return {
        content: [
          {
            type: "text",
            text: `# ${page.title}\nSource: ${page.url}${page.truncated ? "\n(content truncated)" : ""}\n\n${page.content}`,
          },
        ],
      };
    },
  );

  server.tool(
    "list_fri3d_badge_pages",
    "List all known pages and sections of the Fri3d Camp 2026 badge documentation " +
      "(parsed from MkDocs Material's prebuilt search_index.json).",
    {},
    async () => {
      const pages = await listFri3dPages();
      const lines = pages.map(
        (p) => `- [${p.lang}]${p.isSection ? " (section)" : "         "} ${p.title}  →  ${p.url}`,
      );
      return {
        content: [
          {
            type: "text",
            text: `Fri3d badge_2026 pages (${pages.length}):\n\n${lines.join("\n")}`,
          },
        ],
      };
    },
  );
  // ---------------------------------------------------------------------------
  // MicroPythonOS docs
  // ---------------------------------------------------------------------------

  server.tool(
    "search_micropythonos_docs",
    "Search the MicroPythonOS documentation (docs.micropythonos.com). " +
      "Returns ranked pages with a snippet around the match.",
    {
      query: z.string().min(1).describe("Free-text search query."),
      limit: z.number().int().min(1).max(25).optional().describe("Max results (default 10)."),
    },
    async ({ query, limit }) => {
      const hits = await searchMicropythonOSDocs(query, { limit });
      if (hits.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No MicroPythonOS docs pages match "${query}". Try \`list_micropythonos_pages\` to browse all pages.`,
            },
          ],
        };
      }
      const lines = hits.map(
        (h, i) =>
          `${i + 1}. ${h.title}\n   url:   ${h.url}\n   score: ${h.score}\n   …${h.snippet}…`,
      );
      return {
        content: [
          { type: "text", text: `MicroPythonOS docs results for "${query}":\n\n${lines.join("\n\n")}` },
        ],
      };
    },
  );

  server.tool(
    "get_micropythonos_page",
    "Fetch a MicroPythonOS documentation page and return its cleaned text content. " +
      "Accepts a path like 'frameworks/app-manager/' or a full docs.micropythonos.com URL.",
    {
      path: z.string().min(1).describe("Page path or full URL on the docs.micropythonos.com site."),
      maxChars: z.number().int().min(500).max(200_000).optional().describe("Max chars (default 40000)."),
    },
    async ({ path, maxChars }) => {
      const page = await getMicropythonOSPage(path, { maxChars });
      return {
        content: [
          {
            type: "text",
            text: `# ${page.title}\nSource: ${page.url}${page.truncated ? "\n(content truncated)" : ""}\n\n${page.content}`,
          },
        ],
      };
    },
  );

  server.tool(
    "list_micropythonos_pages",
    "List all known pages and sections of the MicroPythonOS documentation " +
      "(parsed from MkDocs Material's prebuilt search_index.json).",
    {},
    async () => {
      const pages = await listMicropythonOSPages();
      const lines = pages.map(
        (p) => `- ${p.isSection ? "(section) " : "         "}${p.title}  →  ${p.url}`,
      );
      return {
        content: [
          {
            type: "text",
            text: `MicroPythonOS docs pages (${pages.length}):\n\n${lines.join("\n")}`,
          },
        ],
      };
    },
  );
}, {
  serverInfo: { name: "fri3d-badge-mcp", version: "0.1.0" },
}, {
  // Expose streamable-HTTP transport only.
  disableSse: true,
});

export { handler as GET, handler as POST, handler as DELETE };

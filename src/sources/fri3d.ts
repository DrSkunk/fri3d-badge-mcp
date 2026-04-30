/**
 * Fri3d Camp 2026 badge documentation source.
 *
 * The site is MkDocs Material. Its built-in search ships a single prebuilt
 * index at:
 *
 *   https://fri3dcamp.github.io/badge_2026/search/search_index.json
 *
 * Shape (abridged):
 *   {
 *     config: { lang: ["en","nl"], separator: "...", pipeline: [...] },
 *     docs: [
 *       { location: "",           title: "...", text: "html…" },
 *       { location: "#status",    title: "Status", text: "…" },
 *       { location: "en/",        title: "...", text: "…" },
 *       …
 *     ]
 *   }
 *
 * Each `location` may include a `#anchor`, in which case it represents a
 * section of a parent page. We score by token frequency in title and text,
 * with a bonus for matches in the title.
 */

import { TtlCache } from "../lib/cache.js";
import { fetchText } from "../lib/fetch.js";
import { htmlToText, truncate } from "../lib/html.js";
import { stem } from "../lib/stem.js";

const BASE = "https://fri3dcamp.github.io/badge_2026";
const SEARCH_INDEX_URL = `${BASE}/search/search_index.json`;

interface MkDocsDoc {
  location: string;
  title: string;
  text: string;
}

interface MkDocsIndex {
  config?: { lang?: string[] };
  docs: MkDocsDoc[];
}

interface PreparedDoc extends MkDocsDoc {
  /** location without "#anchor". */
  pagePath: string;
  /** anchor part (without #), or "". */
  anchor: string;
  /** lowercased text used for matching. */
  textLc: string;
  titleLc: string;
  url: string;
  lang: "nl" | "en" | "other";
}

const indexCache = new TtlCache<PreparedDoc[]>(30 * 60 * 1000, "fri3d-index");
const pageCache = new TtlCache<{ title: string; text: string }>(30 * 60 * 1000, "fri3d-pages");

async function loadIndex(): Promise<PreparedDoc[]> {
  return indexCache.memo("idx", async () => {
    const raw = await fetchText(SEARCH_INDEX_URL, 20_000);
    const parsed = JSON.parse(raw) as MkDocsIndex;
    if (!Array.isArray(parsed.docs)) {
      throw new Error("Fri3d search_index.json missing `docs` array");
    }
    return parsed.docs.map((d): PreparedDoc => {
      const [pagePath, anchor = ""] = d.location.split("#", 2);
      const lang: PreparedDoc["lang"] = pagePath.startsWith("en/") || pagePath === "en"
        ? "en"
        : pagePath === "" || !pagePath.includes("/") || pagePath.startsWith("/")
          ? "nl"
          : "nl";
      const text = stripHtml(d.text);
      return {
        ...d,
        pagePath,
        anchor,
        text,
        textLc: text.toLowerCase(),
        titleLc: d.title.toLowerCase(),
        url: `${BASE}/${pagePath}${anchor ? `#${anchor}` : ""}`,
        lang,
      };
    });
  });
}

function stripHtml(s: string): string {
  return s
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface Fri3dPageRef {
  url: string;
  path: string;
  title: string;
  lang: "nl" | "en" | "other";
  isSection: boolean;
}

export async function listFri3dPages(): Promise<Fri3dPageRef[]> {
  const docs = await loadIndex();
  return docs.map((d) => ({
    url: d.url,
    path: d.location || "/",
    title: d.title,
    lang: d.lang,
    isSection: d.anchor !== "",
  }));
}

export interface Fri3dSearchHit {
  url: string;
  title: string;
  snippet: string;
  score: number;
  lang: "nl" | "en" | "other";
}

export async function searchFri3dDocs(
  query: string,
  options: { limit?: number; lang?: "nl" | "en" | "all" } = {},
): Promise<Fri3dSearchHit[]> {
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 25);
  const lang = options.lang ?? "all";
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  const docs = await loadIndex();
  const filtered = lang === "all" ? docs : docs.filter((d) => d.lang === lang);

  const N = filtered.length || 1;
  const df: Record<string, number> = {};
  for (const tok of tokens) {
    df[tok] = filtered.reduce(
      (n, d) => n + (d.textLc.includes(tok) || d.titleLc.includes(tok) ? 1 : 0),
      0,
    );
  }

  type Scored = { doc: PreparedDoc; score: number; firstHit: number };
  const scored: Scored[] = [];

  for (const doc of filtered) {
    let score = 0;
    let firstHit = -1;
    for (const tok of tokens) {
      const stemmed = stem(tok);
      const titleHits = countOccurrences(doc.titleLc, tok) + (stemmed !== tok ? countOccurrences(doc.titleLc, stemmed) : 0);
      const bodyHits = countOccurrences(doc.textLc, tok) + (stemmed !== tok ? countOccurrences(doc.textLc, stemmed) : 0);

      if (titleHits + bodyHits === 0) continue;

      const w = idf(N, df[tok] || 1);
      score += titleHits * 5 * w + bodyHits * 1 * w;
      if (firstHit < 0) {
        const idx = doc.textLc.indexOf(tok);
        if (idx >= 0) firstHit = idx;
      }
    }
    if (score > 0) scored.push({ doc, score, firstHit });
  }

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map(({ doc, score, firstHit }) => {
    const start = Math.max(0, firstHit - 80);
    const end = Math.min(doc.text.length, (firstHit < 0 ? 0 : firstHit) + 200);
    const snippet = doc.text.slice(start, end).replace(/\s+/g, " ").trim();
    return {
      url: doc.url,
      title: doc.title,
      snippet,
      score: round(score, 3),
      lang: doc.lang,
    };
  });
}

function idf(totalDocs: number, df: number): number {
  if (df <= 0) return 0;
  return Math.max(0.1, Math.log((totalDocs - df + 0.5) / (df + 0.5) + 1));
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) {
    count++;
    i += needle.length;
  }
  return count;
}

function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^a-z0-9_.]+/g)
    .filter((t) => t.length >= 2);
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export interface Fri3dPage {
  url: string;
  title: string;
  content: string;
  truncated: boolean;
}

export async function getFri3dPage(
  pathOrUrl: string,
  options: { maxChars?: number } = {},
): Promise<Fri3dPage> {
  const maxChars = options.maxChars ?? 40_000;
  const url = resolveFri3dUrl(pathOrUrl);
  const cached = await pageCache.memo(url, async () => {
    const html = await fetchText(url);
    const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/\s*-\s*Fri3d.*$/i, "").trim() : url;
    return { title, text: htmlToText(html) };
  });
  return {
    url,
    title: cached.title,
    content: truncate(cached.text, maxChars),
    truncated: cached.text.length > maxChars,
  };
}

function resolveFri3dUrl(input: string): string {
  if (/^https?:\/\//i.test(input)) {
    const u = new URL(input);
    if (u.hostname !== "fri3dcamp.github.io" || !u.pathname.startsWith("/badge_2026")) {
      throw new Error(`Refusing to fetch URL outside the Fri3d badge_2026 site: ${input}`);
    }
    return u.toString();
  }
  const path = input.replace(/^\/+/, "");
  return `${BASE}/${path}`;
}

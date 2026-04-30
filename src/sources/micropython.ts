/**
 * MicroPython documentation source.
 *
 * Backed by the Sphinx `searchindex.js` shipped at every docs URL:
 *   https://docs.micropython.org/en/<version>/searchindex.js
 *
 * We parse the index once per warm Vercel instance and then answer searches
 * entirely in-memory. The index gives us:
 *
 *   - `docnames`/`titles`            : all pages
 *   - `terms` / `titleterms`         : stemmed token → docIdx[]
 *   - `objects` / `objnames`         : Python symbols → (docIdx, type, anchor, …)
 *
 * We use all three buckets, weight title and symbol hits higher than body
 * hits, and apply an IDF-style decay so a query like "machine pin" doesn't
 * get drowned out by every page that uses the word "pin".
 */

import { TtlCache } from "../lib/cache.js";
import { fetchText } from "../lib/fetch.js";
import { htmlToText, truncate } from "../lib/html.js";
import { stem } from "../lib/stem.js";

const DEFAULT_VERSION = "latest";
const BASE = (version: string) => `https://docs.micropython.org/en/${version}`;

/** Per-object tuple from Sphinx: [docIdx, objtypeIdx, prio, anchor, dispname]. */
type ObjectTuple = [number, number, number, string, string];

interface SphinxIndex {
  docnames: string[];
  filenames: string[];
  titles: string[];
  /** stemmed term → docIdx | docIdx[] | nested object of the same. */
  terms: Record<string, unknown>;
  titleterms: Record<string, unknown>;
  /** module name ("" for globals) → memberName → ObjectTuple. */
  objects?: Record<string, Record<string, ObjectTuple>>;
  /** objtypeIdx → [domain, role, label]. */
  objnames?: Record<string, [string, string, string]>;
}

const indexCache = new TtlCache<SphinxIndex>(60 * 60 * 1000, "micropython-index"); // 1h
const pageCache = new TtlCache<string>(15 * 60 * 1000, "micropython-pages"); // 15min

async function loadIndex(version: string): Promise<SphinxIndex> {
  return indexCache.memo(version, async () => {
    const url = `${BASE(version)}/searchindex.js`;
    const raw = await fetchText(url, 20_000);
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) {
      throw new Error("Could not locate JSON payload in searchindex.js");
    }
    const json = raw.slice(start, end + 1);
    const parsed = JSON.parse(json) as SphinxIndex;
    if (!parsed.docnames || !parsed.titles) {
      throw new Error("searchindex.js missing expected fields");
    }
    return parsed;
  });
}

function collectDocRefs(value: unknown, out: Set<number>): void {
  if (value == null) return;
  if (typeof value === "number") {
    out.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectDocRefs(v, out);
    return;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectDocRefs(v, out);
    }
  }
}

function countDocRefs(value: unknown): number {
  const tmp = new Set<number>();
  collectDocRefs(value, tmp);
  return tmp.size;
}

export interface MicropythonSearchHit {
  title: string;
  path: string;
  url: string;
  /** Page-relative anchor for the most relevant section, when known. */
  anchor?: string;
  score: number;
  matchedTerms: string[];
  /** Object/symbol name when the hit was driven by a symbol match. */
  symbol?: string;
}

export async function searchMicropythonDocs(
  query: string,
  options: { limit?: number; version?: string } = {},
): Promise<MicropythonSearchHit[]> {
  const version = options.version ?? DEFAULT_VERSION;
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 50);
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  const index = await loadIndex(version);
  const N = index.docnames.length;

  interface DocScore {
    score: number;
    matched: Set<string>;
    anchor?: string;
    symbol?: string;
  }
  const scores = new Map<number, DocScore>();

  const bump = (
    docIdx: number,
    weight: number,
    term: string,
    extra?: { anchor?: string; symbol?: string },
  ) => {
    const cur = scores.get(docIdx) ?? { score: 0, matched: new Set<string>() };
    cur.score += weight;
    cur.matched.add(term);
    if (extra?.anchor && !cur.anchor) cur.anchor = extra.anchor;
    if (extra?.symbol && !cur.symbol) cur.symbol = extra.symbol;
    scores.set(docIdx, cur);
  };

  for (const tok of tokens) {
    const stemmed = stem(tok);

    // Term lookups — weighted by IDF so common words contribute less.
    const titleHits = lookupTerm(index.titleterms, tok, stemmed);
    const bodyHits = lookupTerm(index.terms, tok, stemmed);

    const titleIdf = idf(N, titleHits.size);
    const bodyIdf = idf(N, bodyHits.size);

    for (const docIdx of titleHits) bump(docIdx, 5 * titleIdf, tok);
    for (const docIdx of bodyHits) bump(docIdx, 1 * bodyIdf, tok);

    // Symbol lookups — module names and member names.
    if (index.objects) {
      for (const [modName, members] of Object.entries(index.objects)) {
        if (modName && modName.toLowerCase().includes(tok)) {
          const tup =
            (members as Record<string, ObjectTuple>)[""] ??
            members[modName.split(".").pop() ?? ""];
          if (tup) {
            bump(tup[0], 6, tok, { symbol: modName, anchor: tup[3] || undefined });
          }
        }
        for (const [memberName, tup] of Object.entries(members)) {
          if (!Array.isArray(tup) || typeof tup[0] !== "number") continue;
          const display = tup[4] || memberName;
          const fullName = modName ? `${modName}.${display}` : display;
          const haystack = `${memberName} ${display} ${fullName}`.toLowerCase();
          if (haystack.includes(tok)) {
            const exact =
              memberName.toLowerCase() === tok ||
              display.toLowerCase() === tok ||
              fullName.toLowerCase() === tok;
            bump(tup[0], exact ? 8 : 3, tok, {
              symbol: fullName,
              anchor: tup[3] || undefined,
            });
          }
        }
      }
    }
  }

  if (scores.size === 0) return [];

  const ranked = [...scores.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, limit);

  return ranked.map(([docIdx, info]) => {
    const docname = index.docnames[docIdx];
    const rawTitle = index.titles[docIdx] ?? docname;
    return {
      title: cleanSphinxTitle(rawTitle),
      path: `${docname}.html`,
      url: `${BASE(version)}/${docname}.html${info.anchor ? `#${info.anchor}` : ""}`,
      anchor: info.anchor,
      score: round(info.score, 3),
      matchedTerms: [...info.matched],
      symbol: info.symbol,
    };
  });
}

function idf(totalDocs: number, df: number): number {
  if (df <= 0) return 0;
  // Smoothed IDF; floor so very common terms still nudge ordering when
  // they're the only signal.
  return Math.max(0.1, Math.log((totalDocs - df + 0.5) / (df + 0.5) + 1));
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function cleanSphinxTitle(t: string): string {
  return t.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^a-z0-9_.]+/g)
    .filter((t) => t.length >= 2);
}

/**
 * Resolve a query token against a Sphinx term bucket.
 *
 * Strategy (in order, stop at first non-empty):
 *   1. exact match on the original token
 *   2. exact match on the Porter-stemmed token
 *   3. keys that start with the stemmed token (e.g. "neopix" → "neopixel")
 *
 * We deliberately avoid the reverse direction (token starts with key),
 * because the index contains 1- and 2-character stems and that match
 * direction causes massive false-positive bleed (e.g. "n" matches every
 * page on the site).
 */
function lookupTerm(
  bucket: Record<string, unknown> | undefined,
  token: string,
  stemmed: string,
): Set<number> {
  const out = new Set<number>();
  if (!bucket) return out;

  if (token in bucket) collectDocRefs(bucket[token], out);
  if (out.size > 0) return out;

  if (stemmed !== token && stemmed in bucket) collectDocRefs(bucket[stemmed], out);
  if (out.size > 0) return out;

  if (stemmed.length >= 4) {
    let expansionDocs = 0;
    for (const key of Object.keys(bucket)) {
      if (key.startsWith(stemmed)) {
        expansionDocs += countDocRefs(bucket[key]);
        if (expansionDocs > 200) break;
        collectDocRefs(bucket[key], out);
      }
    }
  }
  return out;
}

export interface MicropythonPage {
  url: string;
  title: string;
  content: string;
  truncated: boolean;
}

export async function getMicropythonPage(
  pathOrUrl: string,
  options: { maxChars?: number; version?: string; section?: string } = {},
): Promise<MicropythonPage> {
  const version = options.version ?? DEFAULT_VERSION;
  const maxChars = options.maxChars ?? 60_000;
  const url = resolveMicropythonUrl(pathOrUrl, version, options.section);

  const fetchUrl = stripFragment(url);
  const html = await pageCache.memo(fetchUrl, () => fetchText(fetchUrl));
  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s*&mdash;.*$/, "").trim() : url;

  const sectionId = options.section ?? new URL(url).hash.replace(/^#/, "");
  let text: string;
  if (sectionId) {
    const sectionHtml = extractSection(html, sectionId);
    text = sectionHtml ? htmlToText(sectionHtml) : htmlToText(html);
  } else {
    text = htmlToText(html);
  }

  const truncated = text.length > maxChars;
  return {
    url,
    title,
    content: truncate(text, maxChars),
    truncated,
  };
}

function stripFragment(url: string): string {
  const u = new URL(url);
  u.hash = "";
  return u.toString();
}

function extractSection(html: string, id: string): string | null {
  const escId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Sphinx wraps each section as: <section id="..."> … </section>
  const sec = html.match(
    new RegExp(`<section\\s[^>]*id=["']${escId}["'][\\s\\S]*?</section>`, "i"),
  );
  if (sec) return sec[0];
  // Older themes used <div class="section" id="…">.
  const div = html.match(
    new RegExp(`<div\\s[^>]*id=["']${escId}["'][\\s\\S]*?</div>`, "i"),
  );
  if (div) return div[0];
  // Anchor on a heading — slice from the heading until the next heading.
  const heading = html.match(
    new RegExp(`<h([1-6])[^>]*id=["']${escId}["'][\\s\\S]*?</h\\1>`, "i"),
  );
  if (heading && heading.index !== undefined) {
    const after = html.slice(heading.index);
    const stop = after.slice(1).search(/<h[1-6]\b/);
    return stop > 0 ? after.slice(0, stop + 1) : after.slice(0, 4000);
  }
  // Sphinx Python-domain entries: <dt id="machine.Pin.irq">…</dt><dd>…</dd>
  // The anchor sits on a <dt>; the description is in the immediately
  // following <dd>. We capture both.
  const dt = html.match(
    new RegExp(`<dt[^>]*id=["']${escId}["'][\\s\\S]*?</dt>\\s*<dd[\\s\\S]*?</dd>`, "i"),
  );
  if (dt) return dt[0];
  // Fallback: any element with that id — capture a slice after it until the
  // next element with an id of similar shape (sibling API entry / heading).
  const generic = html.match(new RegExp(`id=["']${escId}["']`, "i"));
  if (generic && generic.index !== undefined) {
    // Walk back to the start of the enclosing tag.
    const tagStart = html.lastIndexOf("<", generic.index);
    if (tagStart >= 0) {
      const after = html.slice(tagStart);
      const stop = after.slice(1).search(/<(?:dt|h[1-6]|section)\b/);
      return stop > 0 ? after.slice(0, stop + 1) : after.slice(0, 4000);
    }
  }
  return null;
}

function resolveMicropythonUrl(input: string, version: string, section?: string): string {
  if (/^https?:\/\//i.test(input)) {
    const u = new URL(input);
    if (!u.hostname.endsWith("micropython.org")) {
      throw new Error(`Refusing to fetch non-micropython.org URL: ${input}`);
    }
    if (section) u.hash = section;
    return u.toString();
  }
  let path = input.replace(/^\/+/, "");
  if (!path.endsWith(".html") && !path.endsWith("/")) path += ".html";
  const url = new URL(`${BASE(version)}/${path}`);
  if (section) url.hash = section;
  return url.toString();
}

/** Curated list of common modules — kept stable so listing is instant. */
export const MICROPYTHON_COMMON_MODULES: { module: string; path: string; description: string }[] = [
  { module: "machine", path: "library/machine.html", description: "Hardware-related functions (Pin, ADC, PWM, I2C, SPI, UART, RTC, Timer, ...)" },
  { module: "network", path: "library/network.html", description: "Network configuration (WLAN, LAN, WLAN_STA/AP, ...)" },
  { module: "asyncio", path: "library/asyncio.html", description: "Asynchronous I/O scheduler (subset of CPython asyncio)" },
  { module: "neopixel", path: "library/neopixel.html", description: "Drive WS2812/NeoPixel RGB LED strips" },
  { module: "framebuf", path: "library/framebuf.html", description: "Frame buffer manipulation for displays" },
  { module: "bluetooth", path: "library/bluetooth.html", description: "Low-level Bluetooth Low Energy (BLE) interface" },
  { module: "esp32", path: "library/esp32.html", description: "ESP32-specific functionality" },
  { module: "esp", path: "library/esp.html", description: "ESP8266/ESP32 specific functions" },
  { module: "rp2", path: "library/rp2.html", description: "RP2040/RP2350 specific functionality (PIO, etc.)" },
  { module: "uos / os", path: "library/os.html", description: "Basic OS services (file system, urandom, ...)" },
  { module: "utime / time", path: "library/time.html", description: "Time-related functions" },
  { module: "ujson / json", path: "library/json.html", description: "JSON encoding/decoding" },
  { module: "urequests", path: "library/urequests.html", description: "HTTP requests (MicroPython subset)" },
  { module: "socket", path: "library/socket.html", description: "Socket networking" },
  { module: "ssl", path: "library/ssl.html", description: "SSL/TLS module" },
  { module: "umqtt.simple", path: "library/umqtt.simple.html", description: "Lightweight MQTT client" },
  { module: "gc", path: "library/gc.html", description: "Garbage collector control" },
  { module: "sys", path: "library/sys.html", description: "System-specific functions" },
  { module: "micropython", path: "library/micropython.html", description: "Access and control MicroPython internals" },
  { module: "Quick reference: ESP32", path: "esp32/quickref.html", description: "ESP32 pinout, code snippets, tutorial" },
  { module: "Quick reference: RP2", path: "rp2/quickref.html", description: "Raspberry Pi RP2xxx quick reference" },
  { module: "Quick reference: ESP8266", path: "esp8266/quickref.html", description: "ESP8266 quick reference" },
  { module: "Language reference", path: "reference/index.html", description: "MicroPython-specific language features" },
  { module: "Differences from CPython", path: "genrst/index.html", description: "MicroPython operations that differ from CPython" },
];

/**
 * Minimal HTML → plain-text helpers.
 *
 * We intentionally avoid heavy DOM dependencies so the function stays lean
 * inside a Vercel function. The output is good enough for an LLM to read:
 * scripts/styles/nav are stripped, common block tags become newlines,
 * remaining tags are removed and HTML entities are decoded.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  copy: "©",
  reg: "®",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  laquo: "«",
  raquo: "»",
  rarr: "→",
  larr: "←",
};

function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_, ent: string) => {
    if (ent.startsWith("#x") || ent.startsWith("#X")) {
      const code = parseInt(ent.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    }
    if (ent.startsWith("#")) {
      const code = parseInt(ent.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    }
    return NAMED_ENTITIES[ent] ?? "";
  });
}

/**
 * Try to extract the main content area of a page; falls back to body.
 */
function extractMainSection(html: string): string {
  // Sphinx (MicroPython): <div role="main"> ... </div>
  const sphinx = html.match(/<div[^>]*role=["']main["'][^>]*>([\s\S]*?)<\/div>\s*<footer/i);
  if (sphinx) return sphinx[1];

  // mkdocs-material (Fri3d badge): <article ...> ... </article>
  const article = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  if (article) return article[1];

  // <main>...</main>
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  if (main) return main[1];

  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  return body ? body[1] : html;
}

export function htmlToText(html: string): string {
  let s = extractMainSection(html);

  // Drop scripts / styles / nav / svg / forms entirely.
  s = s.replace(/<(script|style|nav|svg|form|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  // Drop self-closing meta/link/img alt-only.
  s = s.replace(/<(?:meta|link)\b[^>]*\/?>/gi, "");

  // Convert headings to markdown-ish so the LLM keeps structure.
  s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level: string, inner: string) => {
    const hashes = "#".repeat(Number(level));
    return `\n\n${hashes} ${stripTags(inner).trim()}\n\n`;
  });

  // Code blocks.
  s = s.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_m, inner: string) => {
    return `\n\n\`\`\`\n${decodeEntities(stripTags(inner)).trimEnd()}\n\`\`\`\n\n`;
  });

  // Inline code.
  s = s.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_m, inner: string) => {
    return `\`${decodeEntities(stripTags(inner))}\``;
  });

  // List items.
  s = s.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_m, inner: string) => {
    return `\n- ${stripTags(inner).trim()}`;
  });

  // Paragraph & block-ish tags → blank lines.
  s = s.replace(/<\/(p|div|section|article|tr|table|ul|ol|dl|dt|dd|blockquote)>/gi, "\n\n");
  s = s.replace(/<br\s*\/?>(?!\n)/gi, "\n");

  // Strip remaining tags.
  s = stripTags(s);

  // Decode entities, collapse whitespace.
  s = decodeEntities(s);
  s = s.replace(/\u00a0/g, " ");
  s = s.replace(/[ \t]+\n/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "");
}

export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n…[truncated ${text.length - maxChars} characters]…`;
}

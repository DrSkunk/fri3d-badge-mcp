/**
 * Shared fetch helper with a sensible UA and timeout.
 * MicroPython docs and the Fri3d MkDocs site are both static GitHub Pages,
 * but we still want to fail fast if a request hangs.
 */

const DEFAULT_TIMEOUT_MS = 15_000;
const USER_AGENT =
  "fri3d-badge-mcp/0.1 (+https://github.com/) docs-fetcher";

export async function fetchText(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "text/html,*/*" },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

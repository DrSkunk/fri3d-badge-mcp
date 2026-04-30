/**
 * TTL cache with optional disk persistence and stale-while-revalidate (SWR).
 *
 * Two layers:
 *   L1 – in-memory Map  (fast; lost on process exit)
 *   L2 – JSON files on disk in os.tmpdir()/fri3d-badge-mcp/<namespace>/
 *         (survives process restarts; used when diskNamespace is provided)
 *
 * SWR behaviour (when disk layer is active):
 *   • age < ttlMs          → return cached value immediately (fresh)
 *   • ttlMs ≤ age < 2×ttlMs → return stale value immediately AND refresh in
 *                              background so the *next* call gets fresh data
 *   • age ≥ 2×ttlMs        → fetch synchronously (cache is too stale)
 *
 * Without a diskNamespace the cache behaves exactly as before (in-memory TTL
 * only, no SWR).
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

interface Entry<T> {
  value: T;
  expiresAt: number;
}

export class TtlCache<T> {
  private store = new Map<string, Entry<T>>();
  private diskDir: string | undefined;
  /** Keys currently being refreshed in the background (SWR). */
  private refreshing = new Set<string>();

  constructor(private readonly ttlMs: number, diskNamespace?: string) {
    if (diskNamespace) {
      this.diskDir = join(tmpdir(), "fri3d-badge-mcp", diskNamespace);
      try {
        mkdirSync(this.diskDir, { recursive: true });
      } catch {
        // If we can't create the dir, fall back to memory-only.
        this.diskDir = undefined;
      }
    }
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    const expiresAt = Date.now() + this.ttlMs;
    this.store.set(key, { value, expiresAt });
    if (this.diskDir) {
      this.writeDisk(key, { value, expiresAt });
    }
  }

  async memo(key: string, loader: () => Promise<T>): Promise<T> {
    // L1: memory hit (fresh).
    const memHit = this.get(key);
    if (memHit !== undefined) return memHit;

    if (this.diskDir) {
      const disk = this.readDisk(key);
      if (disk) {
        const age = Date.now() - (disk.expiresAt - this.ttlMs);

        if (age < this.ttlMs) {
          // Disk entry is fresh – load into memory and return.
          this.store.set(key, { value: disk.value, expiresAt: disk.expiresAt });
          return disk.value;
        }

        if (age < 2 * this.ttlMs) {
          // Disk entry is stale but not ancient → SWR: serve stale now,
          // refresh in background.
          this.store.set(key, { value: disk.value, expiresAt: disk.expiresAt });
          if (!this.refreshing.has(key)) {
            this.refreshing.add(key);
            loader()
              .then((fresh) => {
                this.set(key, fresh);
              })
              .catch(() => {
                // Ignore refresh errors; the stale value stays valid.
              })
              .finally(() => {
                this.refreshing.delete(key);
              });
          }
          return disk.value;
        }
        // Disk entry is too stale (> 2×TTL) → fall through to synchronous
        // fetch below.
      }
    }

    // No usable cached value – fetch synchronously.
    const value = await loader();
    this.set(key, value);
    return value;
  }

  private diskPath(key: string): string {
    // Sanitise the key so it's safe as a filename; exclude dots to prevent
    // directory traversal (e.g. keys containing '../').
    const safe = key.replace(/[^a-zA-Z0-9_-]/g, "_");
    return join(this.diskDir!, `${safe}.json`);
  }

  private readDisk(key: string): Entry<T> | null {
    try {
      const raw = readFileSync(this.diskPath(key), "utf8");
      return JSON.parse(raw) as Entry<T>;
    } catch {
      return null;
    }
  }

  private writeDisk(key: string, entry: Entry<T>): void {
    try {
      writeFileSync(this.diskPath(key), JSON.stringify(entry), "utf8");
    } catch {
      // Disk write failures are non-fatal; memory cache still works.
    }
  }
}

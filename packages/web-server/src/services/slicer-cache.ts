import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

/**
 * SP-15: filesystem-backed cache for section-slicer output.
 *
 * Key = sha256(model + "\n" + body + "\n" + promptHash).slice(0, 16).
 * Any of model / body / promptHash changes -> natural miss. MVP has no LRU /
 * TTL; users clean the dir manually if needed. Writes are atomic: tmp file +
 * rename, so a reader never observes a partial JSON payload.
 */
export interface SlicerCacheOptions {
  vaultRoot: string;
}

export interface SlicerCacheKeyInput {
  model: string;
  body: string;
  promptHash: string;
}

export interface SlicerCacheEntry {
  article_id: string;
  cache_key?: string;
  slicer_model: string;
  slicer_prompt_hash: string;
  slices: unknown[];
  cached_at?: string;
}

const CACHE_SUBDIR = join("08_experts", "_cache", "slicer");

export class SlicerCache {
  private readonly dir: string;

  constructor(opts: SlicerCacheOptions) {
    this.dir = join(opts.vaultRoot, CACHE_SUBDIR);
  }

  computeKey(input: SlicerCacheKeyInput): string {
    return createHash("sha256")
      .update(`${input.model}\n${input.body}\n${input.promptHash}`)
      .digest("hex")
      .slice(0, 16);
  }

  async get(key: string): Promise<SlicerCacheEntry | undefined> {
    const path = join(this.dir, `${key}.json`);
    try {
      const raw = await readFile(path, "utf-8");
      return JSON.parse(raw) as SlicerCacheEntry;
    } catch {
      return undefined;
    }
  }

  async set(key: string, entry: SlicerCacheEntry): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const finalPath = join(this.dir, `${key}.json`);
    const tmpPath = `${finalPath}.tmp.${process.pid}.${Date.now()}`;
    const payload: SlicerCacheEntry = {
      ...entry,
      cache_key: key,
      cached_at: entry.cached_at ?? new Date().toISOString(),
    };
    await writeFile(tmpPath, JSON.stringify(payload, null, 2), "utf-8");
    await rename(tmpPath, finalPath);
  }
}

// ---------------------------------------------------------------------------
// SLICER_PROMPT_HASH — precomputed at module load so orchestrator avoids
// re-hashing the prompt file on every cache lookup.
// ---------------------------------------------------------------------------

export function computeSlicerPromptHash(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 16);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
// Resolve the prompt file shipped with @crossing/agents (sibling workspace
// package at packages/agents/src/prompts/section-slicer.md).
const SLICER_PROMPT_PATH = resolve(
  __dirname,
  "../../../agents/src/prompts/section-slicer.md",
);

export const SLICER_PROMPT_HASH: string = computeSlicerPromptHash(SLICER_PROMPT_PATH);

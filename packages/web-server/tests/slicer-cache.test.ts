import { describe, it, expect } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  SlicerCache,
  SLICER_PROMPT_HASH,
  computeSlicerPromptHash,
} from "../src/services/slicer-cache.js";

const freshVault = () => mkdtempSync(join(tmpdir(), "slicer-cache-"));

describe("SlicerCache", () => {
  it("computes a stable 16-char hex key from (model, body, promptHash)", () => {
    const cache = new SlicerCache({ vaultRoot: freshVault() });
    const k1 = cache.computeKey({ model: "claude-sonnet-4-5", body: "hello", promptHash: "abc" });
    const k2 = cache.computeKey({ model: "claude-sonnet-4-5", body: "hello", promptHash: "abc" });
    const k3 = cache.computeKey({ model: "claude-opus-4-6", body: "hello", promptHash: "abc" });
    expect(k1).toMatch(/^[a-f0-9]{16}$/);
    expect(k1).toBe(k2);
    expect(k1).not.toBe(k3);
  });

  it("returns undefined on miss and persists on set under _cache/slicer", async () => {
    const vault = freshVault();
    const cache = new SlicerCache({ vaultRoot: vault });
    const key = cache.computeKey({ model: "m", body: "b", promptHash: "p" });
    expect(await cache.get(key)).toBeUndefined();

    await cache.set(key, {
      article_id: "a1",
      slicer_model: "m",
      slicer_prompt_hash: "p",
      slices: [{ start_char: 0, end_char: 1, role: "opening" }],
    });

    const dir = join(vault, "08_experts", "_cache", "slicer");
    const files = readdirSync(dir);
    expect(files).toContain(`${key}.json`);
    const roundTrip = await cache.get(key);
    expect(roundTrip?.slices?.[0]?.role).toBe("opening");
    expect(roundTrip?.cached_at).toBeTruthy();
    expect(roundTrip?.cache_key).toBe(key);
  });

  it("writes atomically via tmp + rename (no partial file under the final name)", async () => {
    const vault = freshVault();
    const cache = new SlicerCache({ vaultRoot: vault });
    const key = cache.computeKey({ model: "m", body: "b", promptHash: "p" });
    await cache.set(key, { article_id: "a1", slicer_model: "m", slicer_prompt_hash: "p", slices: [] });
    const dir = join(vault, "08_experts", "_cache", "slicer");
    const all = readdirSync(dir);
    const finals = all.filter((f) => f.endsWith(".json"));
    const tmps = all.filter((f) => f.endsWith(".tmp"));
    expect(finals.length).toBe(1);
    expect(tmps.length).toBe(0);
    // Valid JSON
    JSON.parse(readFileSync(join(dir, finals[0]!), "utf8"));
  });

  it("returns undefined when the cache file is corrupted (parse error)", async () => {
    const vault = freshVault();
    const cache = new SlicerCache({ vaultRoot: vault });
    const key = cache.computeKey({ model: "m", body: "b", promptHash: "p" });
    const dir = join(vault, "08_experts", "_cache", "slicer");
    await cache.set(key, { article_id: "a1", slicer_model: "m", slicer_prompt_hash: "p", slices: [] });
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(dir, `${key}.json`), "{ not json");
    const r = await cache.get(key);
    expect(r).toBeUndefined();
  });

  it("SP-15 T5: SLICER_PROMPT_HASH is a 16-char hex prefix of the slicer prompt file", () => {
    expect(SLICER_PROMPT_HASH).toMatch(/^[a-f0-9]{16}$/);
    const promptPath = resolve(
      __dirname,
      "../../agents/src/prompts/section-slicer.md",
    );
    const expected = createHash("sha256").update(readFileSync(promptPath)).digest("hex").slice(0, 16);
    expect(SLICER_PROMPT_HASH).toBe(expected);
    expect(computeSlicerPromptHash(promptPath)).toBe(expected);
  });

  it("creates the cache dir lazily on first set", async () => {
    const vault = freshVault();
    const cache = new SlicerCache({ vaultRoot: vault });
    expect(existsSync(join(vault, "08_experts", "_cache", "slicer"))).toBe(false);
    const key = cache.computeKey({ model: "m", body: "b", promptHash: "p" });
    await cache.set(key, { article_id: "a1", slicer_model: "m", slicer_prompt_hash: "p", slices: [] });
    expect(existsSync(join(vault, "08_experts", "_cache", "slicer"))).toBe(true);
  });
});

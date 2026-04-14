import { describe, it, expect } from "vitest";
import { stratifiedSample, pickDeepRead } from "../../src/style-distiller/sample-picker.js";
import type { ArticleSample } from "../../src/style-distiller/types.js";

function mk(id: string, wc: number, published: string): ArticleSample {
  return { id, account: "x", title: id, published_at: published, word_count: wc, body_plain: "" };
}

describe("sample-picker stratifiedSample", () => {
  it("returns all when pool <= sampleSize", () => {
    const pool = [mk("a", 100, "2025-01-01"), mk("b", 200, "2025-02-01")];
    const out = stratifiedSample(pool, 10);
    expect(out).toHaveLength(2);
  });

  it("spreads across word_count quartiles x time buckets", () => {
    const pool: ArticleSample[] = [];
    for (let i = 0; i < 40; i += 1) {
      const q = Math.floor(i / 10);
      const m = (i % 12) + 1;
      const mm = String(m).padStart(2, "0");
      pool.push(mk(`a${i}`, (q + 1) * 1000, `2025-${mm}-01`));
    }
    const sampled = stratifiedSample(pool, 16);
    expect(sampled.length).toBe(16);
    const ids = new Set(sampled.map((s) => s.id));
    expect(ids.size).toBe(16);
    const buckets = new Set(sampled.map((s) => Math.floor((s.word_count - 1) / 1000)));
    expect(buckets.size).toBeGreaterThanOrEqual(3);
  });

  it("fills from next bucket when a bucket is short", () => {
    const pool: ArticleSample[] = [];
    for (let i = 0; i < 5; i += 1) pool.push(mk(`a${i}`, 1000, "2025-01-01"));
    for (let i = 0; i < 20; i += 1) pool.push(mk(`b${i}`, 5000, `2025-0${(i % 8) + 1}-01`));
    const sampled = stratifiedSample(pool, 15);
    expect(sampled.length).toBe(15);
    const ids = new Set(sampled.map((s) => s.id));
    expect(ids.size).toBe(15);
  });
});

describe("sample-picker pickDeepRead", () => {
  it("picks 5-8 articles with word_count + time diversity", () => {
    const pool: ArticleSample[] = [];
    for (let i = 0; i < 30; i += 1) {
      const m = String((i % 12) + 1).padStart(2, "0");
      pool.push(mk(`a${i}`, 500 + i * 200, `2025-${m}-01`));
    }
    const picked = pickDeepRead(pool, 7);
    expect(picked.length).toBe(7);
    const ids = new Set(picked.map((p) => p.id));
    expect(ids.size).toBe(7);
    const wcs = picked.map((p) => p.word_count).sort((a, b) => a - b);
    expect(wcs[wcs.length - 1]! - wcs[0]!).toBeGreaterThan(1000);
  });

  it("clamps requested count to pool size", () => {
    const pool = [mk("a", 100, "2025-01-01"), mk("b", 200, "2025-02-01")];
    const picked = pickDeepRead(pool, 7);
    expect(picked.length).toBe(2);
  });
});

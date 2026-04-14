import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WikiStore } from "../../src/wiki/wiki-store.js";
import { searchWiki } from "../../src/wiki/search-wiki.js";

function seed(): string {
  const dir = mkdtempSync(join(tmpdir(), "sw-"));
  const s = new WikiStore(dir);
  s.applyPatch({ op: "upsert", path: "entities/PixVerse-C1.md", frontmatter: { type: "entity", title: "PixVerse-C1", aliases: ["PixVerse", "C1"] }, body: "PixVerse C1 是一款视频生成模型。用于 AI 漫剧分镜。" });
  s.applyPatch({ op: "upsert", path: "concepts/AI漫剧.md", frontmatter: { type: "concept", title: "AI漫剧", aliases: ["漫剧"] }, body: "AI 漫剧是指用 AI 生成分镜的漫画剧。" });
  s.applyPatch({ op: "upsert", path: "entities/LibTV.md", frontmatter: { type: "entity", title: "LibTV" }, body: "LibTV 是 AI 电视平台，跟漫剧无关。" });
  s.applyPatch({ op: "upsert", path: "persons/镜山.md", frontmatter: { type: "person", title: "镜山" }, body: "镜山是产品人。" });
  return dir;
}

describe("searchWiki", () => {
  it("returns results matching query across title + body", async () => {
    const dir = seed();
    const out = await searchWiki({ query: "AI 漫剧" }, { vaultPath: dir });
    expect(out.length).toBeGreaterThan(0);
    const paths = out.map((r) => r.path);
    expect(paths).toContain("concepts/AI漫剧.md");
  });

  it("filters by kind", async () => {
    const dir = seed();
    const out = await searchWiki({ query: "漫剧", kind: "entity" }, { vaultPath: dir });
    expect(out.every((r) => r.kind === "entity")).toBe(true);
    expect(out.some((r) => r.path === "entities/PixVerse-C1.md")).toBe(true);
  });

  it("respects limit (default 5)", async () => {
    const dir = seed();
    const out = await searchWiki({ query: "AI", limit: 2 }, { vaultPath: dir });
    expect(out.length).toBeLessThanOrEqual(2);
  });

  it("returns [] on empty wiki", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sw-empty-"));
    const out = await searchWiki({ query: "anything" }, { vaultPath: dir });
    expect(out).toEqual([]);
  });

  it("alias match scores same as title match", async () => {
    const dir = seed();
    const out = await searchWiki({ query: "C1" }, { vaultPath: dir });
    expect(out[0]!.path).toBe("entities/PixVerse-C1.md");
  });

  it("each result includes excerpt (<=300 chars) + frontmatter + score", async () => {
    const dir = seed();
    const out = await searchWiki({ query: "AI 漫剧" }, { vaultPath: dir });
    for (const r of out) {
      expect(r.excerpt.length).toBeLessThanOrEqual(300);
      expect(typeof r.score).toBe("number");
      expect(r.frontmatter.type).toBeDefined();
    }
  });
});

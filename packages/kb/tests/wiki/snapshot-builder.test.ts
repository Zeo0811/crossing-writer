import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WikiStore } from "../../src/wiki/wiki-store.js";
import { buildSnapshot } from "../../src/wiki/snapshot-builder.js";

function seed() {
  const dir = mkdtempSync(join(tmpdir(), "snap-"));
  const s = new WikiStore(dir);
  s.applyPatch({ op: "upsert", path: "entities/PixVerse-C1.md", frontmatter: { type: "entity", title: "PixVerse-C1", aliases: ["PixVerse", "C1"] }, body: "# PixVerse-C1\n\nPixVerse C1 是视频生成模型" });
  s.applyPatch({ op: "upsert", path: "concepts/AI漫剧.md", frontmatter: { type: "concept", title: "AI漫剧", aliases: ["漫剧"] }, body: "# AI漫剧\n\n漫剧是指..." });
  s.applyPatch({ op: "upsert", path: "entities/LibTV.md", frontmatter: { type: "entity", title: "LibTV" }, body: "# LibTV\n\nLibTV 是 AI 电视" });
  return { dir, s };
}

describe("buildSnapshot", () => {
  it("returns pages whose title/alias match article titles", () => {
    const { dir } = seed();
    const snap = buildSnapshot(dir, [
      { id: "a1", title: "PixVerse C1 实测", published_at: "2026-01-01", body_plain: "..." },
    ], 10);
    const paths = snap.pages.map((p) => p.path);
    expect(paths).toContain("entities/PixVerse-C1.md");
  });

  it("matches on body_plain keywords against titles/aliases", () => {
    const { dir } = seed();
    const snap = buildSnapshot(dir, [
      { id: "a1", title: "本周动态", published_at: "2026-01-01", body_plain: "这周 AI漫剧 成为热点" },
    ], 10);
    const paths = snap.pages.map((p) => p.path);
    expect(paths).toContain("concepts/AI漫剧.md");
  });

  it("respects topK and provides indexMd", () => {
    const { dir } = seed();
    const snap = buildSnapshot(dir, [
      { id: "a1", title: "PixVerse 和 LibTV 对比 漫剧", published_at: "2026-01-01", body_plain: "" },
    ], 2);
    expect(snap.pages.length).toBeLessThanOrEqual(2);
    expect(typeof snap.indexMd).toBe("string");
  });

  it("returns empty snapshot on empty wiki", () => {
    const dir = mkdtempSync(join(tmpdir(), "empty-"));
    const snap = buildSnapshot(dir, [{ id: "a1", title: "x", published_at: "2026-01-01", body_plain: "" }], 10);
    expect(snap.pages).toEqual([]);
  });
});

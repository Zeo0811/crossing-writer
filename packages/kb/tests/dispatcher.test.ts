import { describe, it, expect, vi, beforeEach } from "vitest";
import { dispatchSkill, parseSkillArgs } from "../src/skills/dispatcher.js";

vi.mock("../src/skills/search-raw.js", () => ({
  searchRaw: vi.fn(() => [
    { article_id: "a1", account: "十字路口Crossing", title: "AI 漫剧爆了", published_at: "2026-04-08", snippet: "AI <b>漫剧</b> PixVerse" },
  ]),
}));
vi.mock("../src/wiki/search-wiki.js", () => ({
  searchWiki: vi.fn(() => [
    { path: "concepts/AI漫剧.md", title: "AI漫剧", kind: "concept", score: 12.3, excerpt: "AI 漫剧指……" },
  ]),
}));

const ctx = { vaultPath: "/tmp/vault", sqlitePath: "/tmp/refs.sqlite" };

describe("parseSkillArgs", () => {
  it("extracts quoted query + --key=value pairs", () => {
    const p = parseSkillArgs(["\"AI 漫剧\"", "--kind=concept", "--limit=5"]);
    expect(p.query).toBe("AI 漫剧");
    expect(p.args).toEqual({ kind: "concept", limit: "5" });
  });

  it("treats first non-flag token as query", () => {
    const p = parseSkillArgs(["Sora", "--limit=2"]);
    expect(p.query).toBe("Sora");
    expect(p.args).toEqual({ limit: "2" });
  });

  it("handles empty", () => {
    const p = parseSkillArgs([]);
    expect(p.query).toBe("");
    expect(p.args).toEqual({});
  });
});

describe("dispatchSkill", () => {
  beforeEach(() => vi.clearAllMocks());

  it("routes search_wiki", async () => {
    const r = await dispatchSkill({ command: "search_wiki", args: ["\"AI 漫剧\"", "--kind=concept", "--limit=5"] }, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tool).toBe("search_wiki");
      expect(r.query).toBe("AI 漫剧");
      expect(r.args).toMatchObject({ kind: "concept", limit: "5" });
      expect(r.hits_count).toBe(1);
      expect(r.formatted).toContain("concepts/AI漫剧.md");
    }
  });

  it("routes search_raw", async () => {
    const r = await dispatchSkill({ command: "search_raw", args: ["\"漫剧\"", "--account=十字路口Crossing", "--limit=2"] }, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tool).toBe("search_raw");
      expect(r.hits_count).toBe(1);
      expect(r.formatted).toContain("AI 漫剧爆了");
      expect(r.formatted).toContain("<b>漫剧</b>");
    }
  });

  it("returns ok=false for unknown tool", async () => {
    const r = await dispatchSkill({ command: "search_foo", args: [] }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("unknown tool");
  });

  it("truncates large formatted payload", async () => {
    const { searchRaw } = await import("../src/skills/search-raw.js");
    (searchRaw as any).mockReturnValueOnce(
      Array.from({ length: 500 }, (_, i) => ({
        article_id: `a${i}`, account: "x", title: "t".repeat(200), published_at: "2026-01-01", snippet: "s".repeat(200),
      })),
    );
    const r = await dispatchSkill({ command: "search_raw", args: ["x"] }, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.formatted.length).toBeLessThanOrEqual(20_500);
  });
});

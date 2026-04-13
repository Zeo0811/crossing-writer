import { describe, it, expect, vi } from "vitest";
import { buildRefsPack } from "../src/services/refs-fetcher.js";

vi.mock("@crossing/kb", () => ({
  searchRefs: vi.fn(),
}));

import * as kb from "@crossing/kb";

function mkSearchResult(id: string, title: string, account: string) {
  return {
    id,
    title,
    account,
    author: null,
    publishedAt: "2025-06-01",
    url: `u-${id}`,
    summary: `sum-${id}`,
    mdPath: `/p/${id}.md`,
    snippet: "",
    topicsCore: [],
    topicsFine: [],
    wordCount: null,
    score: 0,
  };
}

describe("buildRefsPack", () => {
  it("aggregates multi-query results with dedup", () => {
    vi.mocked(kb.searchRefs).mockImplementation((_ctx: any, opts: any) => {
      if (opts.query === "q1") {
        return [mkSearchResult("1", "A1", "量子位"), mkSearchResult("2", "A2", "智东西")];
      }
      if (opts.query === "q2") {
        return [mkSearchResult("2", "A2", "智东西"), mkSearchResult("3", "A3", "硅星人Pro")];
      }
      return [];
    });

    const md = buildRefsPack({
      ctx: { sqlitePath: "/x", vaultPath: "/v" },
      queries: ["q1", "q2", "nothing"],
      limitPerQuery: 10,
      totalLimit: 30,
    });
    expect(md).toMatch(/A1/);
    expect(md).toMatch(/A2/);
    expect(md).toMatch(/A3/);
    expect((md.match(/A2/g) ?? []).length).toBe(1);
  });

  it("respects totalLimit", () => {
    vi.mocked(kb.searchRefs).mockImplementation((_ctx: any, opts: any) => {
      if (opts.query === "big") {
        return Array.from({ length: 20 }, (_, i) => mkSearchResult(`${i}`, `T${i}`, "a"));
      }
      return [];
    });
    const md = buildRefsPack({
      ctx: { sqlitePath: "/x", vaultPath: "/v" },
      queries: ["big"],
      limitPerQuery: 20,
      totalLimit: 5,
    });
    const headings = md.match(/^## \d+\./gm) ?? [];
    expect(headings.length).toBe(5);
  });

  it("skips empty queries", () => {
    vi.mocked(kb.searchRefs).mockReset();
    buildRefsPack({
      ctx: { sqlitePath: "/x", vaultPath: "/v" },
      queries: ["", "  ", "real"],
    });
    const calls = vi.mocked(kb.searchRefs).mock.calls;
    expect(calls.length).toBe(1);
    expect((calls[0]![1] as any).query).toBe("real");
  });

  it("writes frontmatter with queries + total", () => {
    vi.mocked(kb.searchRefs).mockReturnValue([mkSearchResult("1", "X", "a")]);
    const md = buildRefsPack({
      ctx: { sqlitePath: "/x", vaultPath: "/v" },
      queries: ["hello"],
    });
    expect(md).toMatch(/type:\s*refs_pack/);
    expect(md).toMatch(/total:\s*1/);
    expect(md).toMatch(/"hello"/);
  });
});

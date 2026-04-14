import { describe, it, expect, vi, beforeEach } from "vitest";
import { getPages, getPage, search, status } from "../src/api/wiki-client";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

describe("wiki-client REST", () => {
  it("getPages calls /api/kb/wiki/pages", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => [{ path: "entities/A.md", kind: "entity", title: "A" }] });
    const out = await getPages();
    expect(out[0].path).toBe("entities/A.md");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/kb/wiki/pages");
  });

  it("getPages forwards kind filter", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => [] });
    await getPages("concept");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/kb/wiki/pages?kind=concept");
  });

  it("getPage fetches markdown text", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, text: async () => "# A" });
    const out = await getPage("entities/A.md");
    expect(out).toBe("# A");
  });

  it("search returns ranked results", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => [{ path: "entities/A.md", score: 1 }] });
    const out = await search({ query: "A", kind: "entity", limit: 5 });
    expect(out[0].score).toBe(1);
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/kb/wiki/search?q=A&kind=entity&limit=5");
  });

  it("status returns counts", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ total: 2, by_kind: { entity: 2 }, last_ingest_at: null }) });
    const out = await status();
    expect(out.total).toBe(2);
  });
});

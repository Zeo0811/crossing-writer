import { beforeEach, describe, expect, it, vi } from "vitest";
import { suggestRefs } from "../writer-client";

describe("suggestRefs", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches /api/writer/suggest with q and limit and returns items", async () => {
    const items = [
      { kind: "wiki", id: "a.md", title: "A", excerpt: "hi" },
      { kind: "raw", id: "r1", title: "R", excerpt: "ex", account: "acc", published_at: "2026-01-01" },
    ];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ items }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await suggestRefs("AI");
    expect(res).toEqual(items);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain("/api/writer/suggest");
    expect(url).toContain("q=AI");
    expect(url).toContain("limit=12");
  });

  it("honors custom limit and url-encodes the query", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ items: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await suggestRefs("北京 AI", 5);
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain("limit=5");
    expect(url).toMatch(/q=%E5%8C%97%E4%BA%AC/);
  });

  it("returns [] when response has no items field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }),
    );
    expect(await suggestRefs("x")).toEqual([]);
  });

  it("throws on non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }),
    );
    await expect(suggestRefs("x")).rejects.toThrow(/500/);
  });
});

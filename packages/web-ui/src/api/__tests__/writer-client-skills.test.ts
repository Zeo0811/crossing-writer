import { beforeEach, describe, expect, it, vi } from "vitest";
import { callSkill, deletePin, getPinned } from "../writer-client";

describe("writer-client skills API", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("callSkill posts tool+args to the section skill endpoint and returns SkillResult", async () => {
    const payload = {
      ok: true,
      tool: "search_raw",
      query: "北京",
      args: { query: "北京" },
      hits: [],
      hits_count: 0,
      formatted: "(no hits)",
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => payload,
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await callSkill("p1", "s1", "search_raw", { query: "北京" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/projects/p1/writer/sections/s1/skill");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ tool: "search_raw", args: { query: "北京" } });
    expect(res).toEqual(payload);
  });

  it("callSkill returns an ok:false SkillResult when fetch returns a non-OK status", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await callSkill("p1", "s1", "search_raw", {});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("HTTP 500");
  });

  it("getPinned GETs pinned list and deletePin DELETEs by index", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ pins: [{ foo: 1 }] }) })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const pinned = await getPinned("p1", "s1");
    expect(pinned).toEqual({ pins: [{ foo: 1 }] });
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/projects/p1/writer/sections/s1/pinned");

    await deletePin("p1", "s1", 2);
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe("/api/projects/p1/writer/sections/s1/pinned/2");
    expect(init.method).toBe("DELETE");
  });
});

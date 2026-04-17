import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useWikiIndex, __resetWikiIndexCache } from "../../src/hooks/useWikiIndex";

beforeEach(() => {
  __resetWikiIndexCache();
  vi.restoreAllMocks();
});

describe("useWikiIndex", () => {
  it("fetches index.json once and caches across hook instances", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify([{ path: "entities/A.md", title: "A", aliases: ["a1"] }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const { result: r1 } = renderHook(() => useWikiIndex());
    await waitFor(() => expect(r1.current.entries.length).toBe(1));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const { result: r2 } = renderHook(() => useWikiIndex());
    await waitFor(() => expect(r2.current.entries.length).toBe(1));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("exposes error on fetch failure", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("boom", { status: 500 }));
    const { result } = renderHook(() => useWikiIndex());
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.entries).toEqual([]);
  });
});

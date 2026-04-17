import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useIngestCart, type CartEntry } from "../src/hooks/useIngestCart";

const e1: CartEntry = { articleId: "A0", account: "AcctA", title: "t0", publishedAt: "2026-04-15", wordCount: 100 };
const e2: CartEntry = { articleId: "A1", account: "AcctA", title: "t1", publishedAt: "2026-04-14", wordCount: 200 };
const e3: CartEntry = { articleId: "B0", account: "AcctB", title: "tB0", publishedAt: "2026-04-13", wordCount: 300 };

describe("useIngestCart", () => {
  it("starts empty", () => {
    const { result } = renderHook(() => useIngestCart({ maxArticles: 50 }));
    expect(result.current.entries).toEqual([]);
    expect(result.current.totalCount).toBe(0);
    expect(result.current.exceedsMax).toBe(false);
  });

  it("toggle adds then removes an entry", () => {
    const { result } = renderHook(() => useIngestCart({ maxArticles: 50 }));
    act(() => { result.current.toggle(e1); });
    expect(result.current.entries.map((e) => e.articleId)).toEqual(["A0"]);
    act(() => { result.current.toggle(e1); });
    expect(result.current.entries).toEqual([]);
  });

  it("tracks totals and account breakdown", () => {
    const { result } = renderHook(() => useIngestCart({ maxArticles: 50 }));
    act(() => { result.current.toggle(e1); result.current.toggle(e2); result.current.toggle(e3); });
    expect(result.current.totalCount).toBe(3);
    expect(result.current.perAccountCount.get("AcctA")).toBe(2);
    expect(result.current.perAccountCount.get("AcctB")).toBe(1);
  });

  it("exceedsMax when total > maxArticles", () => {
    const { result } = renderHook(() => useIngestCart({ maxArticles: 2 }));
    act(() => { result.current.toggle(e1); result.current.toggle(e2); result.current.toggle(e3); });
    expect(result.current.exceedsMax).toBe(true);
  });

  it("has returns whether an id is in the cart", () => {
    const { result } = renderHook(() => useIngestCart({ maxArticles: 50 }));
    act(() => { result.current.toggle(e1); });
    expect(result.current.has("A0")).toBe(true);
    expect(result.current.has("A1")).toBe(false);
  });

  it("remove deletes by articleId", () => {
    const { result } = renderHook(() => useIngestCart({ maxArticles: 50 }));
    act(() => { result.current.toggle(e1); result.current.toggle(e2); });
    act(() => { result.current.remove("A0"); });
    expect(result.current.entries.map((e) => e.articleId)).toEqual(["A1"]);
  });

  it("clear wipes everything", () => {
    const { result } = renderHook(() => useIngestCart({ maxArticles: 50 }));
    act(() => { result.current.toggle(e1); result.current.toggle(e2); });
    act(() => { result.current.clear(); });
    expect(result.current.entries).toEqual([]);
  });
});

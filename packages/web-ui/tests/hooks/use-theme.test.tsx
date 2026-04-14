import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTheme } from "../../src/hooks/useTheme";

function setMatchMedia(matches: (q: string) => boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (q: string) => ({
      matches: matches(q),
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    }),
  });
}

describe("useTheme", () => {
  beforeEach(() => {
    try { localStorage.removeItem("crossing_theme"); } catch {}
    document.documentElement.removeAttribute("data-theme");
  });

  it("defaults to dark when no storage and no system pref", () => {
    setMatchMedia(() => false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("honors localStorage override", () => {
    localStorage.setItem("crossing_theme", "light");
    setMatchMedia(() => false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("light");
  });

  it("falls back to prefers-color-scheme: dark when no storage", () => {
    setMatchMedia((q) => q.includes("dark"));
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("dark");
  });

  it("toggle flips and persists", () => {
    setMatchMedia(() => false);
    const { result } = renderHook(() => useTheme());
    act(() => result.current.toggle());
    expect(result.current.theme).toBe("light");
    expect(localStorage.getItem("crossing_theme")).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });
});

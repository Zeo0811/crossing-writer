import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useCliHealth } from "../../src/hooks/useCliHealth";
import * as api from "../../src/api/system-health";

const sample = {
  claude: { status: "online", version: "1.4.2", checkedAt: "t" },
  codex: { status: "offline", error: "command not found", checkedAt: "t" },
} as const;

describe("useCliHealth", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("fetches on mount and polls every 30s", async () => {
    const spy = vi.spyOn(api, "fetchCliHealth").mockResolvedValue(sample as any);
    const { result } = renderHook(() => useCliHealth());
    await vi.waitFor(() => {
      expect(result.current.data).not.toBeNull();
    });
    expect(spy).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("stops polling on unmount", async () => {
    const spy = vi.spyOn(api, "fetchCliHealth").mockResolvedValue(sample as any);
    const { unmount } = renderHook(() => useCliHealth());
    await vi.waitFor(() => {
      expect(spy).toHaveBeenCalledTimes(1);
    });
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("surfaces errors without throwing", async () => {
    vi.spyOn(api, "fetchCliHealth").mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useCliHealth());
    await vi.waitFor(() => {
      expect(result.current.error).toBeInstanceOf(Error);
    });
  });
});

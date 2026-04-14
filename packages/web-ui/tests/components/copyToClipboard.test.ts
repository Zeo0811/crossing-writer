import { describe, it, expect, vi, afterEach } from "vitest";
import { copyToClipboard } from "../../src/components/status/copyToClipboard";

const originalNav = globalThis.navigator;

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(globalThis, "navigator", {
    value: originalNav,
    configurable: true,
    writable: true,
  });
});

function setNavigator(nav: any) {
  Object.defineProperty(globalThis, "navigator", {
    value: nav,
    configurable: true,
    writable: true,
  });
}

describe("copyToClipboard", () => {
  it("uses navigator.clipboard when available", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    setNavigator({ clipboard: { writeText: write } });
    await expect(copyToClipboard("hello")).resolves.toBe(true);
    expect(write).toHaveBeenCalledWith("hello");
  });

  it("falls back to execCommand when clipboard API throws", async () => {
    setNavigator({ clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    const exec = vi.fn().mockReturnValue(true);
    (document as any).execCommand = exec;
    await expect(copyToClipboard("hello")).resolves.toBe(true);
    expect(exec).toHaveBeenCalledWith("copy");
  });

  it("returns false when both paths fail", async () => {
    setNavigator({ clipboard: undefined });
    (document as any).execCommand = () => {
      throw new Error("no");
    };
    await expect(copyToClipboard("hello")).resolves.toBe(false);
  });
});

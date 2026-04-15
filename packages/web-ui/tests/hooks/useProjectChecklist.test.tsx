import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useProjectChecklist } from "../../src/hooks/useProjectChecklist";

vi.mock("../../src/hooks/useProjectStream", () => ({
  useProjectStream: () => ({ events: [], activeAgents: [] }),
}));

function mockFetchOk(body: unknown) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => body,
  })) as any;
}

describe("useProjectChecklist", () => {
  beforeEach(() => {
    globalThis.fetch = mockFetchOk({
      projectId: "p1",
      items: [{ step: "brief", status: "done" }],
      generatedAt: "2026-04-18T00:00:00Z",
    });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it("fetches on mount", async () => {
    const { result } = renderHook(() => useProjectChecklist("p1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data?.items[0]?.step).toBe("brief");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/projects/p1/checklist",
      expect.anything(),
    );
  });

  it("refetch re-invokes fetch", async () => {
    const { result } = renderHook(() => useProjectChecklist("p1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.refetch(); });
    expect((globalThis.fetch as any).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("surfaces error on non-2xx", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })) as any;
    const { result } = renderHook(() => useProjectChecklist("p1"));
    await waitFor(() => expect(result.current.error).not.toBeNull());
  });

  it("skips fetch when projectId is empty", async () => {
    globalThis.fetch = vi.fn();
    const { result } = renderHook(() => useProjectChecklist(undefined));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

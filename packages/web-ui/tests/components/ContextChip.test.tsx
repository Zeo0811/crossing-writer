import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ContextChip } from "../../src/components/project/ContextChip";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  // @ts-expect-error injecting global fetch
  global.fetch = fetchMock;
});
afterEach(() => {
  // @ts-expect-error reset
  global.fetch = undefined;
});

describe("ContextChip", () => {
  it("renders floating chip with token estimate after fetching summary", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        projectId: "p1", builtAt: "2026-04-19T00:00:00Z",
        tokensEstimated: 3200, truncated: false,
      }),
    });
    render(<ContextChip projectId="p1" />);
    const chip = await waitFor(() => screen.getByTestId("context-chip"));
    expect(chip).toHaveTextContent("Context");
    expect(chip).toHaveTextContent("3.2k");
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p1/context?summary=1");
  });

  it("opens ContextModal on click", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          projectId: "p1", builtAt: "t", tokensEstimated: 100, truncated: false,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ projectId: "p1", brief: { summary: "X" } }),
      });
    render(<ContextChip projectId="p1" />);
    const chip = await waitFor(() => screen.getByTestId("context-chip"));
    fireEvent.click(chip);
    await waitFor(() => screen.getByTestId("context-modal"));
  });

  it("renders nothing if summary fetch fails", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    const { container } = render(<ContextChip projectId="px" />);
    await new Promise((r) => setTimeout(r, 10));
    expect(container.querySelector('[data-testid="context-chip"]')).toBeNull();
  });
});

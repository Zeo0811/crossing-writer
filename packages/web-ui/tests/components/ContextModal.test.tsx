import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { ContextModal } from "../../src/components/project/ContextModal";

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

describe("ContextModal", () => {
  it("fetches /api/projects/:id/context and renders pretty-printed JSON in <pre>", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ projectId: "p1", brief: { summary: "HELLO" } }),
    });
    render(<ContextModal projectId="p1" onClose={() => {}} />);
    const pre = await waitFor(() => screen.getByTestId("context-modal-pre"));
    expect(pre.textContent).toContain("HELLO");
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p1/context");
  });

  it("calls onClose when overlay clicked", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ projectId: "p1" }),
    });
    const onClose = vi.fn();
    render(<ContextModal projectId="p1" onClose={onClose} />);
    const overlay = await waitFor(() => screen.getByTestId("context-modal"));
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalled();
  });

  it("shows error message when fetch fails", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) });
    render(<ContextModal projectId="px" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Error:/)).toBeInTheDocument());
  });
});

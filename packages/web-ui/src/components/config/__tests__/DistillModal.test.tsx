import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

vi.mock("../../../api/writer-client.js", () => ({
  distillStylePanel: vi.fn(),
  distillAllRoles: vi.fn(),
}));

import { DistillModal } from "../DistillModal.js";
import { distillStylePanel, distillAllRoles } from "../../../api/writer-client.js";

type EventCb = (ev: { type: string; error?: string; data?: any }) => void;

function makeStream() {
  let cb: EventCb | null = null;
  return {
    stream: {
      onEvent: (fn: EventCb) => { cb = fn; },
      close: vi.fn(),
    },
    emit: (ev: { type: string; error?: string; data?: any }) => {
      if (cb) cb(ev);
    },
  };
}

beforeEach(() => {
  vi.mocked(distillStylePanel).mockReset();
  vi.mocked(distillAllRoles).mockReset();
});

describe("DistillModal", () => {
  it("renders target account/role and flow steps", () => {
    render(
      <DistillModal
        account="acctA"
        role="opening"
        onClose={() => {}}
        onSuccess={() => {}}
      />,
    );
    expect(screen.getByText(/acctA/)).toBeInTheDocument();
    expect(screen.getAllByText(/opening/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /开始蒸馏/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /取消/ })).toBeInTheDocument();
  });

  it("on 开始 subscribes stream and updates slicer progress", async () => {
    const s = makeStream();
    vi.mocked(distillStylePanel).mockReturnValue(s.stream as any);

    render(
      <DistillModal
        account="acctA"
        role="opening"
        onClose={() => {}}
        onSuccess={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /开始蒸馏/ }));
    expect(distillStylePanel).toHaveBeenCalledWith("acctA", "opening", 10);

    act(() => s.emit({ type: "distill.started" }));
    act(() => s.emit({ type: "distill.slicer_progress", data: { processed: 23, total: 50 } }));
    await waitFor(() => expect(screen.getByText(/23\/50/)).toBeInTheDocument());
  });

  it("calls onSuccess and no error on distill.finished", async () => {
    const s = makeStream();
    vi.mocked(distillStylePanel).mockReturnValue(s.stream as any);
    const onSuccess = vi.fn();
    const onClose = vi.fn();

    render(
      <DistillModal
        account="acctA"
        role="opening"
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /开始蒸馏/ }));
    act(() => s.emit({ type: "distill.composer_done" }));
    act(() => s.emit({ type: "distill.finished", data: { panel_path: "/x/a/o/v3.md", version: 3 } }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith({ version: 3, path: "/x/a/o/v3.md" }));
  });

  it("shows error on distill.failed and allows retry", async () => {
    const s1 = makeStream();
    vi.mocked(distillStylePanel).mockReturnValueOnce(s1.stream as any);

    render(
      <DistillModal
        account="acctA"
        role="opening"
        onClose={() => {}}
        onSuccess={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /开始蒸馏/ }));
    act(() => s1.emit({ type: "distill.failed", error: "slicer exploded" }));
    await waitFor(() => expect(screen.getByText(/slicer exploded/)).toBeInTheDocument());

    const s2 = makeStream();
    vi.mocked(distillStylePanel).mockReturnValueOnce(s2.stream as any);
    fireEvent.click(screen.getByRole("button", { name: /重试/ }));
    expect(distillStylePanel).toHaveBeenCalledTimes(2);
  });

  describe("role='all' mode", () => {
    it("renders 全部 title and WAITING rows for 3 roles", () => {
      render(
        <DistillModal
          account="acctA"
          role="all"
          onClose={() => {}}
          onSuccess={() => {}}
        />,
      );
      expect(screen.getByText(/全部 \(opening \+ practice \+ closing\)/)).toBeInTheDocument();
      const statusEl = screen.getByTestId("distill-roles-status");
      expect(statusEl.textContent).toMatch(/opening:\s*WAITING/);
      expect(statusEl.textContent).toMatch(/practice:\s*WAITING/);
      expect(statusEl.textContent).toMatch(/closing:\s*WAITING/);
    });

    it("subscribes distillAllRoles and updates per-role status on events", async () => {
      const s = makeStream();
      vi.mocked(distillAllRoles).mockReturnValue(s.stream as any);

      render(
        <DistillModal
          account="acctA"
          role="all"
          onClose={() => {}}
          onSuccess={() => {}}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: /开始蒸馏/ }));
      expect(distillAllRoles).toHaveBeenCalledWith("acctA", 10);

      act(() => s.emit({ type: "distill_all.started" }));
      act(() => s.emit({ type: "slicer_progress", data: { processed: 7, total: 10 } }));
      await waitFor(() => expect(screen.getByText(/7\/10/)).toBeInTheDocument());

      act(() => s.emit({ type: "role_started", data: { role: "opening" } }));
      await waitFor(() => {
        const statusEl = screen.getByTestId("distill-roles-status");
        expect(statusEl.textContent).toMatch(/opening:\s*RUNNING/);
      });

      act(() => s.emit({ type: "role_done", data: { role: "opening", version: 1, panel_path: "/x/o.md" } }));
      await waitFor(() => {
        const statusEl = screen.getByTestId("distill-roles-status");
        expect(statusEl.textContent).toMatch(/opening:\s*DONE/);
      });

      act(() =>
        s.emit({
          type: "role_failed",
          data: { role: "practice", error: "no slices" },
        }),
      );
      await waitFor(() => {
        const statusEl = screen.getByTestId("distill-roles-status");
        expect(statusEl.textContent).toMatch(/practice:\s*FAILED/);
      });
    });

    it("fires onSuccess with results summary on distill_all.finished", async () => {
      const s = makeStream();
      vi.mocked(distillAllRoles).mockReturnValue(s.stream as any);
      const onSuccess = vi.fn();

      render(
        <DistillModal
          account="acctA"
          role="all"
          onClose={() => {}}
          onSuccess={onSuccess}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: /开始蒸馏/ }));
      act(() =>
        s.emit({
          type: "distill_all.finished",
          data: {
            results: [
              { role: "opening", panel_path: "/x/o.md", version: 1 },
              { role: "practice", panel_path: "/x/p.md", version: 2 },
              { role: "closing", error: "no slices" },
            ],
          },
        }),
      );
      await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
      const arg = onSuccess.mock.calls[0]![0];
      expect(arg.results).toHaveLength(3);
      expect(arg.results[0]).toEqual({
        role: "opening",
        version: 1,
        path: "/x/o.md",
        error: undefined,
      });
      expect(arg.results[2].error).toBe("no slices");
    });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

vi.mock("../../../api/writer-client.js", () => ({
  distillStylePanel: vi.fn(),
}));

import { DistillModal } from "../DistillModal.js";
import { distillStylePanel } from "../../../api/writer-client.js";

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
    expect(distillStylePanel).toHaveBeenCalledWith("acctA", "opening");

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
});

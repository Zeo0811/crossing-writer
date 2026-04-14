import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../src/api/writer-client", () => ({
  startWriter: vi.fn(async () => {}),
  listStylePanels: vi.fn(async () => [
    { id: "赛博禅心", path: "/p", last_updated_at: "t" },
    { id: "数字生命卡兹克", path: "/p2", last_updated_at: "t" },
  ]),
}));

import { WriterConfigForm } from "../../../src/components/writer/WriterConfigForm";
import { startWriter } from "../../../src/api/writer-client";

describe("WriterConfigForm", () => {
  beforeEach(() => { (startWriter as any).mockClear(); });

  it("renders 5 agent blocks with default cli/model from props", async () => {
    render(<WriterConfigForm projectId="pid" defaults={{
      "writer.opening":    { cli: "claude", model: "opus" },
      "writer.practice":   { cli: "claude", model: "sonnet" },
      "writer.closing":    { cli: "claude", model: "opus" },
      "practice.stitcher": { cli: "claude", model: "haiku" },
      "style_critic":      { cli: "claude", model: "opus" },
    }} onStarted={() => {}} />);
    await waitFor(() => expect(screen.getByText(/writer\.opening/)).toBeTruthy());
    expect(screen.getByText(/writer\.practice/)).toBeTruthy();
    expect(screen.getByText(/writer\.closing/)).toBeTruthy();
    expect(screen.getByText(/practice\.stitcher/)).toBeTruthy();
    expect(screen.getByText(/style_critic/)).toBeTruthy();
    expect(screen.getAllByText("赛博禅心").length).toBeGreaterThanOrEqual(4);
  });

  it("submits with selected reference accounts and overrides", async () => {
    const onStarted = vi.fn();
    render(<WriterConfigForm projectId="pid" defaults={{
      "writer.opening":    { cli: "claude", model: "opus" },
      "writer.practice":   { cli: "claude", model: "sonnet" },
      "writer.closing":    { cli: "claude", model: "opus" },
      "practice.stitcher": { cli: "claude", model: "haiku" },
      "style_critic":      { cli: "claude", model: "opus" },
    }} onStarted={onStarted} />);
    await waitFor(() => screen.getByText(/writer\.opening/));
    const openingCzcCheckbox = screen.getAllByLabelText(/writer\.opening.*赛博禅心/)[0]!;
    fireEvent.click(openingCzcCheckbox);
    fireEvent.click(screen.getByRole("button", { name: /开始写作/ }));
    await waitFor(() => expect(startWriter).toHaveBeenCalled());
    const call = (startWriter as any).mock.calls[0];
    expect(call[0]).toBe("pid");
    expect(call[1].reference_accounts_per_agent["writer.opening"]).toContain("赛博禅心");
    expect(onStarted).toHaveBeenCalled();
  });

  it("allows submit with no reference accounts selected", async () => {
    render(<WriterConfigForm projectId="pid" defaults={{
      "writer.opening":    { cli: "claude", model: "opus" },
      "writer.practice":   { cli: "claude", model: "sonnet" },
      "writer.closing":    { cli: "claude", model: "opus" },
      "practice.stitcher": { cli: "claude", model: "haiku" },
      "style_critic":      { cli: "claude", model: "opus" },
    }} onStarted={() => {}} />);
    await waitFor(() => screen.getByText(/writer\.opening/));
    fireEvent.click(screen.getByRole("button", { name: /开始写作/ }));
    await waitFor(() => expect(startWriter).toHaveBeenCalled());
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../src/api/writer-client", () => ({
  startWriter: vi.fn(async () => {}),
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
    await waitFor(() => expect(screen.getByText(/开篇/)).toBeTruthy());
    expect(screen.getByText(/Case 正文/)).toBeTruthy();
    expect(screen.getByText(/收束/)).toBeTruthy();
    expect(screen.getByText(/段落拼接/)).toBeTruthy();
    expect(screen.getByText(/风格审查/)).toBeTruthy();
  });

  it("submits with cli/model overrides", async () => {
    const onStarted = vi.fn();
    render(<WriterConfigForm projectId="pid" defaults={{
      "writer.opening":    { cli: "claude", model: "opus" },
      "writer.practice":   { cli: "claude", model: "sonnet" },
      "writer.closing":    { cli: "claude", model: "opus" },
      "practice.stitcher": { cli: "claude", model: "haiku" },
      "style_critic":      { cli: "claude", model: "opus" },
    }} onStarted={onStarted} />);
    await waitFor(() => screen.getByText(/开篇/));
    fireEvent.click(screen.getByRole("button", { name: /开始写作/ }));
    await waitFor(() => expect(startWriter).toHaveBeenCalled());
    const call = (startWriter as any).mock.calls[0];
    expect(call[0]).toBe("pid");
    expect(call[1].cli_model_per_agent["writer.opening"].cli).toBe("claude");
    expect(call[1].cli_model_per_agent["writer.opening"].model).toBe("opus");
    expect(Object.keys(call[1])).toEqual(["cli_model_per_agent"]);
    expect(onStarted).toHaveBeenCalled();
  });
});

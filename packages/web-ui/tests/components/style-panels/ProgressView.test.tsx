import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ProgressView } from "../../../src/components/style-panels/ProgressView.js";

vi.mock("../../../src/api/style-panels-client.js", () => ({
  startDistillStream: vi.fn(),
}));
import { startDistillStream } from "../../../src/api/style-panels-client.js";

describe("ProgressView", () => {
  beforeEach(() => { (startDistillStream as any).mockReset(); });

  it("shows step-by-step log from SSE events and calls onDone on all_completed", async () => {
    (startDistillStream as any).mockImplementation(async (_account: string, _body: any, onEvent: any) => {
      onEvent({ type: "distill.step_started", data: { step: "quant" } });
      onEvent({ type: "distill.step_completed", data: { step: "quant", duration_ms: 100, stats: { article_count: 20 } } });
      onEvent({ type: "distill.all_completed", data: { account: "X", kb_path: "/x.md" } });
    });
    const onDone = vi.fn();
    render(<ProgressView account="X" body={{ sample_size: 20 }} onDone={onDone} />);
    await waitFor(() => expect(screen.getByText(/\[1\/4\] quant-analyzer/)).toBeInTheDocument());
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("shows failed line when step_failed event arrives", async () => {
    (startDistillStream as any).mockImplementation(async (_a: string, _b: any, onEvent: any) => {
      onEvent({ type: "distill.step_started", data: { step: "structure" } });
      onEvent({ type: "distill.step_failed", data: { step: "structure", error: "boom" } });
    });
    render(<ProgressView account="X" body={{ sample_size: 20 }} onDone={() => {}} />);
    await waitFor(() => expect(screen.getByText(/FAILED: boom/)).toBeInTheDocument());
  });
});

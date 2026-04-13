import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CaseListPanel } from "../../src/components/left/CaseListPanel";

vi.mock("../../src/api/client", () => ({
  getCaseCandidates: vi.fn(async () => `---\ntype: case_plan_candidates\n---\n
# Case 1 — 多宫格分镜
proposed_by: 卡兹克
creativity_score: 9
why_it_matters: "测 C1 主打能力"

body 1

# Case 2 — 动作压测
proposed_by: 卡尔
creativity_score: 8
why_it_matters: "连贯性"

body 2
`),
  selectCases: vi.fn(async () => {}),
}));

describe("CaseListPanel", () => {
  it("renders parsed cases", async () => {
    render(<CaseListPanel projectId="p1" />);
    await waitFor(() => screen.getByText(/多宫格分镜/));
    expect(screen.getByText(/动作压测/)).toBeInTheDocument();
    expect(screen.getByText(/卡兹克/)).toBeInTheDocument();
  });

  it("selects checkboxes and calls selectCases", async () => {
    const { selectCases } = await import("../../src/api/client");
    render(<CaseListPanel projectId="p1" />);
    await waitFor(() => screen.getByText(/多宫格分镜/));
    const boxes = screen.getAllByRole("checkbox");
    fireEvent.click(boxes[0]!);
    fireEvent.click(boxes[1]!);
    fireEvent.click(screen.getByRole("button", { name: /批准/ }));
    await waitFor(() => {
      expect(selectCases).toHaveBeenCalledWith("p1", [1, 2]);
    });
  });

  it("shows 已选 count", async () => {
    render(<CaseListPanel projectId="p1" />);
    await waitFor(() => screen.getByText(/多宫格分镜/));
    expect(screen.getByText(/已选 0/)).toBeInTheDocument();
  });
});

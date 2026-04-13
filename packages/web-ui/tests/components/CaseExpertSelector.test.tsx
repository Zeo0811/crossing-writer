import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CaseExpertSelector } from "../../src/components/right/CaseExpertSelector";
import { ToastProvider } from "../../src/components/ui/ToastProvider";

vi.mock("../../src/api/client", () => ({
  listCaseExperts: vi.fn(async () => [
    { name: "卡兹克", specialty: "视频", creativity_score: 9, preselected: true },
    { name: "赛博禅心", specialty: "禅", creativity_score: 7, preselected: true },
    { name: "黄叔", specialty: "工具", creativity_score: 6, preselected: false },
  ]),
  startCasePlan: vi.fn(async () => {}),
}));

describe("CaseExpertSelector", () => {
  it("renders experts with preselect checked", async () => {
    render(<ToastProvider><CaseExpertSelector projectId="p1" /></ToastProvider>);
    await waitFor(() => screen.getByText(/卡兹克/));
    const kz = screen.getByLabelText(/卡兹克/) as HTMLInputElement;
    const hu = screen.getByLabelText(/黄叔/) as HTMLInputElement;
    expect(kz.checked).toBe(true);
    expect(hu.checked).toBe(false);
  });

  it("starts plan with selected experts", async () => {
    const { startCasePlan } = await import("../../src/api/client");
    render(<ToastProvider><CaseExpertSelector projectId="p1" /></ToastProvider>);
    await waitFor(() => screen.getByText(/卡兹克/));
    fireEvent.click(screen.getByRole("button", { name: /开跑 Case 规划/ }));
    await waitFor(() => {
      expect(startCasePlan).toHaveBeenCalledWith("p1", expect.arrayContaining(["卡兹克", "赛博禅心"]));
    });
  });
});

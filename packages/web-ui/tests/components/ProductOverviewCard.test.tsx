import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ProductOverviewCard } from "../../src/components/left/ProductOverviewCard";
import { ToastProvider } from "../../src/components/ui/ToastProvider";

vi.mock("../../src/api/client", () => ({
  getOverview: vi.fn(async () => "---\ntype: product_overview\n---\n# 产品概览\n正文"),
  patchOverview: vi.fn(async () => {}),
  approveOverview: vi.fn(async () => {}),
}));

describe("ProductOverviewCard", () => {
  it("renders markdown preview", async () => {
    render(<ToastProvider><ProductOverviewCard projectId="p1" status="overview_ready" /></ToastProvider>);
    await waitFor(() => {
      expect(screen.getByText(/产品概览/)).toBeInTheDocument();
    });
  });

  it("enters edit mode and saves", async () => {
    const { patchOverview } = await import("../../src/api/client");
    render(<ToastProvider><ProductOverviewCard projectId="p1" status="overview_ready" /></ToastProvider>);
    await waitFor(() => screen.getByText(/产品概览/));
    fireEvent.click(screen.getByRole("button", { name: /编辑/ }));
    const ta = await screen.findByRole("textbox");
    fireEvent.change(ta, { target: { value: "# 新标题" } });
    fireEvent.click(screen.getByRole("button", { name: /保存/ }));
    await waitFor(() => {
      expect(patchOverview).toHaveBeenCalledWith("p1", "# 新标题");
    });
  });

  it("shows approve button and calls approve", async () => {
    const { approveOverview } = await import("../../src/api/client");
    render(<ToastProvider><ProductOverviewCard projectId="p1" status="overview_ready" /></ToastProvider>);
    await waitFor(() => screen.getByText(/产品概览/));
    fireEvent.click(screen.getByRole("button", { name: /批准进入 Case 规划/ }));
    await waitFor(() => {
      expect(approveOverview).toHaveBeenCalledWith("p1");
    });
  });
});

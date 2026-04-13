import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OverviewIntakeForm } from "../../src/components/right/OverviewIntakeForm";

vi.mock("../../src/api/client", () => ({
  uploadOverviewImage: vi.fn(async () => ({
    filename: "brief-fig-1.png", source: "brief",
    relPath: "context/images/brief-fig-1.png", absPath: "/abs/x",
  })),
  listOverviewImages: vi.fn(async () => []),
  deleteOverviewImage: vi.fn(async () => {}),
  generateOverview: vi.fn(async () => ({ ok: true })),
}));

describe("OverviewIntakeForm", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders brief + screenshot uploaders, URL list, description", () => {
    render(<OverviewIntakeForm projectId="p1" />);
    expect(screen.getByText(/Brief 配图/)).toBeInTheDocument();
    expect(screen.getByText(/产品截图/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/https:\/\//)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/补充描述/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /生成产品概览/ })).toBeInTheDocument();
  });

  it("adds url to list via button", () => {
    render(<OverviewIntakeForm projectId="p1" />);
    const input = screen.getByPlaceholderText(/https:\/\//) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "https://pixverse.ai" } });
    fireEvent.click(screen.getByRole("button", { name: /添加/ }));
    expect(screen.getByText("https://pixverse.ai")).toBeInTheDocument();
  });

  it("calls generateOverview with urls + description when submit", async () => {
    const { generateOverview } = await import("../../src/api/client");
    render(<OverviewIntakeForm projectId="p1" />);
    const input = screen.getByPlaceholderText(/https:\/\//) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "https://x.com" } });
    fireEvent.click(screen.getByRole("button", { name: /添加/ }));
    const ta = screen.getByPlaceholderText(/补充描述/);
    fireEvent.change(ta, { target: { value: "测试" } });
    fireEvent.click(screen.getByRole("button", { name: /生成产品概览/ }));
    await waitFor(() => {
      expect(generateOverview).toHaveBeenCalledWith("p1", {
        productUrls: ["https://x.com"],
        userDescription: "测试",
      });
    });
  });
});

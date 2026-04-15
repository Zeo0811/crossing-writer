import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DeleteProjectModal } from "../../src/components/project/DeleteProjectModal";

const sample = {
  id: "p1", name: "Sample", slug: "sample", status: "created", stage: "intake",
  updated_at: new Date().toISOString(),
} as any;

describe("DeleteProjectModal", () => {
  it("renders project name and slug hint", () => {
    render(<DeleteProjectModal project={sample} onCancel={() => {}} onConfirm={() => {}} />);
    expect(screen.getByText(/删除项目/)).toBeInTheDocument();
    expect(screen.getByRole("heading")).toHaveTextContent("Sample");
    // slug appears inside <code>
    expect(screen.getByText("sample")).toBeInTheDocument();
  });

  it("confirm button is disabled until slug is typed correctly", () => {
    const onConfirm = vi.fn();
    render(<DeleteProjectModal project={sample} onCancel={() => {}} onConfirm={onConfirm} />);
    const btn = screen.getByTestId("confirm-delete-btn") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    const input = screen.getByTestId("confirm-slug-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "wrong" } });
    expect(btn.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "sample" } });
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(onConfirm).toHaveBeenCalledWith("sample");
  });

  it("cancel button calls onCancel", () => {
    const onCancel = vi.fn();
    render(<DeleteProjectModal project={sample} onCancel={onCancel} onConfirm={() => {}} />);
    fireEvent.click(screen.getByTestId("cancel-delete-btn"));
    expect(onCancel).toHaveBeenCalled();
  });
});

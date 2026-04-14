import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DistillForm } from "../../../src/components/style-panels/DistillForm.js";

describe("DistillForm", () => {
  it("submits with default sample_size=200 and chosen cli/model overrides", () => {
    const onSubmit = vi.fn();
    render(<DistillForm account="赛博禅心" totalInRange={1229} onCancel={() => {}} onSubmit={onSubmit} />);
    expect(screen.getByText(/赛博禅心/)).toBeInTheDocument();
    expect(screen.getByText(/1229/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/sample_size/i), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText(/since/i), { target: { value: "2025-01-01" } });
    fireEvent.change(screen.getByLabelText(/until/i), { target: { value: "2026-04-01" } });
    fireEvent.click(screen.getByRole("button", { name: /开始蒸馏/ }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ sample_size: 100, since: "2025-01-01", until: "2026-04-01" }));
  });

  it("rejects sample_size < 20", () => {
    const onSubmit = vi.fn();
    render(<DistillForm account="X" totalInRange={100} onCancel={() => {}} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/sample_size/i), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /开始蒸馏/ }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/至少 20/)).toBeInTheDocument();
  });
});

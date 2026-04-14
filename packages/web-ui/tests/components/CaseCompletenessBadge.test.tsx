import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CaseCompletenessBadge } from "../../src/components/evidence/CaseCompletenessBadge";

describe("CaseCompletenessBadge", () => {
  it("complete: green ✅", () => {
    render(<CaseCompletenessBadge completeness={{
      complete: true, missing: [],
      has_screenshot: true, has_notes: true, has_generated: true,
    }} />);
    expect(screen.getByTestId("evidence-badge").className).toMatch(/green/);
    expect(screen.getByText(/完整/)).toBeInTheDocument();
  });

  it("partial: yellow with missing labels", () => {
    render(<CaseCompletenessBadge completeness={{
      complete: false, missing: ["notes", "generated"],
      has_screenshot: true, has_notes: false, has_generated: false,
    }} />);
    expect(screen.getByTestId("evidence-badge").className).toMatch(/yellow/);
    expect(screen.getByText(/缺.*笔记.*产出/)).toBeInTheDocument();
  });

  it("empty: gray 待上传", () => {
    render(<CaseCompletenessBadge completeness={{
      complete: false, missing: ["screenshot", "notes", "generated"],
      has_screenshot: false, has_notes: false, has_generated: false,
    }} />);
    expect(screen.getByTestId("evidence-badge").className).toMatch(/gray/);
    expect(screen.getByText(/待上传/)).toBeInTheDocument();
  });
});

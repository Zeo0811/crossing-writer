import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProgressBar } from "../../../src/components/ui/ProgressBar";

describe("ProgressBar", () => {
  it("renders filled width and label", () => {
    render(<ProgressBar value={42} />);
    expect(screen.getByText("42%")).toBeInTheDocument();
    const fill = document.querySelector("[data-fill]") as HTMLElement;
    expect(fill.style.width).toBe("42%");
  });

  it("clamps out-of-range values", () => {
    render(<ProgressBar value={999} />);
    const fill = document.querySelector("[data-fill]") as HTMLElement;
    expect(fill.style.width).toBe("100%");
  });

  it("hides label when showLabel=false", () => {
    render(<ProgressBar value={10} showLabel={false} />);
    expect(screen.queryByText("10%")).toBeNull();
  });
});

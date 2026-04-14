import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Chip } from "../../../src/components/ui/Chip";

describe("Chip", () => {
  it("active uses filled dot ● and accent color", () => {
    render(<Chip variant="active">ready</Chip>);
    expect(screen.getByText("●")).toBeInTheDocument();
    expect(screen.getByText("ready").className).toMatch(/border-hair/);
  });

  it("waiting uses hollow dot ○", () => {
    render(<Chip variant="waiting">queued</Chip>);
    expect(screen.getByText("○")).toBeInTheDocument();
  });

  it("warn uses ◉ and amber classes", () => {
    render(<Chip variant="warn">review</Chip>);
    expect(screen.getByText("◉")).toBeInTheDocument();
    expect(screen.getByText("review").className).toMatch(/text-amber/);
  });

  it("legacy uses ▣", () => {
    render(<Chip variant="legacy">old</Chip>);
    expect(screen.getByText("▣")).toBeInTheDocument();
  });

  it("deleted renders strike-through style", () => {
    render(<Chip variant="deleted">gone</Chip>);
    const root = screen.getByText("gone");
    expect(root.className).toMatch(/line-through/);
  });
});

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Card } from "../../../src/components/ui/Card";

describe("Card", () => {
  it("renders section variant with bg-1 + hair border", () => {
    render(<Card data-testid="c">body</Card>);
    const el = screen.getByTestId("c");
    expect(el.className).toMatch(/bg-bg-1/);
    expect(el.className).toMatch(/border-hair/);
  });

  it("panel variant uses bg-2 no border", () => {
    render(<Card variant="panel" data-testid="c">x</Card>);
    expect(screen.getByTestId("c").className).toMatch(/bg-bg-2/);
  });

  it("agent variant adds accent left strip", () => {
    render(<Card variant="agent" data-testid="c">x</Card>);
    expect(screen.getByTestId("c").className).toMatch(/border-l-2/);
  });

  it("renders halftone corner when halftone=true", () => {
    render(<Card halftone data-testid="c">x</Card>);
    const el = screen.getByTestId("c");
    expect(el.querySelector("[data-halftone]")).toBeTruthy();
  });
});

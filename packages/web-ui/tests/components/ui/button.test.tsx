import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Button } from "../../../src/components/ui/Button";

describe("Button", () => {
  it("renders primary variant with accent bg classes", () => {
    render(<Button variant="primary">Run</Button>);
    const b = screen.getByRole("button", { name: "Run" });
    expect(b.className).toMatch(/bg-accent/);
    expect(b.className).toMatch(/text-accent-on/);
  });

  it("secondary variant has hairline border", () => {
    render(<Button variant="secondary">Cancel</Button>);
    expect(screen.getByRole("button").className).toMatch(/border-hair/);
  });

  it("ghost variant is transparent", () => {
    render(<Button variant="ghost">Skip</Button>);
    expect(screen.getByRole("button").className).toMatch(/bg-transparent/);
  });

  it("fires onClick", () => {
    const fn = vi.fn();
    render(<Button onClick={fn}>Go</Button>);
    fireEvent.click(screen.getByRole("button"));
    expect(fn).toHaveBeenCalledOnce();
  });

  it("honors disabled", () => {
    render(<Button disabled>Go</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });
});

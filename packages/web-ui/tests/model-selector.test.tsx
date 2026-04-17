import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ModelSelector } from "../src/components/wiki/ModelSelector";

// NOTE: Radix DropdownMenu portal does not open reliably in jsdom.
// Tests 4 & 5 use data-testid on each MenuItem (model-item-{model}) to
// directly fire click events, bypassing the portal open/close cycle.

beforeEach(() => { localStorage.clear(); });

describe("ModelSelector", () => {
  it("defaults to claude/sonnet when no saved value", () => {
    render(<ModelSelector onChange={() => {}} />);
    expect(screen.getByText(/claude\/sonnet/)).toBeInTheDocument();
  });

  it("reads saved value from localStorage", () => {
    localStorage.setItem("crossing:wiki:model", JSON.stringify({ cli: "codex", model: "gpt-5" }));
    render(<ModelSelector onChange={() => {}} />);
    expect(screen.getByText(/codex\/gpt-5/)).toBeInTheDocument();
  });

  it("onChange called with initial value on mount", () => {
    const onChange = vi.fn();
    render(<ModelSelector onChange={onChange} />);
    expect(onChange).toHaveBeenCalledWith({ cli: "claude", model: "sonnet" });
  });

  it("onChange called with new value after selection", () => {
    const onChange = vi.fn();
    render(<ModelSelector onChange={onChange} />);
    onChange.mockClear();
    // Radix portal doesn't open in jsdom — click item directly via data-testid
    fireEvent.click(screen.getByTestId("model-item-opus"));
    expect(onChange).toHaveBeenCalledWith({ cli: "claude", model: "opus" });
  });

  it("persists selection to localStorage", () => {
    render(<ModelSelector onChange={() => {}} />);
    // Radix portal doesn't open in jsdom — click item directly via data-testid
    fireEvent.click(screen.getByTestId("model-item-haiku"));
    expect(JSON.parse(localStorage.getItem("crossing:wiki:model")!)).toMatchObject({ cli: "claude", model: "haiku" });
  });
});

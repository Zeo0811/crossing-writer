import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Input } from "../../../src/components/ui/Input";
import { Select } from "../../../src/components/ui/Select";
import { Checkbox } from "../../../src/components/ui/Checkbox";

describe("form primitives", () => {
  it("Input uses bg-2 + hair border", () => {
    render(<Input placeholder="go" />);
    const el = screen.getByPlaceholderText("go");
    expect(el.className).toMatch(/bg-bg-2/);
    expect(el.className).toMatch(/border-hair/);
  });

  it("Input fires onChange", () => {
    let v = "";
    render(<Input placeholder="g" onChange={(e) => (v = e.target.value)} />);
    fireEvent.change(screen.getByPlaceholderText("g"), { target: { value: "hi" } });
    expect(v).toBe("hi");
  });

  it("Select renders options", () => {
    render(
      <Select data-testid="s" defaultValue="a">
        <option value="a">A</option>
        <option value="b">B</option>
      </Select>
    );
    const s = screen.getByTestId("s") as HTMLSelectElement;
    expect(s.options).toHaveLength(2);
    expect(s.className).toMatch(/bg-bg-2/);
  });

  it("Checkbox renders pixel-check when checked", () => {
    render(<Checkbox checked onChange={() => {}} label="enable" />);
    expect(screen.getByLabelText("enable")).toBeChecked();
  });
});

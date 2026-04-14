import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SelectionBubble } from "../SelectionBubble.js";

function makeRect(top = 100, left = 50, width = 80): DOMRect {
  return { top, left, width, height: 20, right: left + width, bottom: top + 20, x: left, y: top, toJSON: () => ({}) } as DOMRect;
}

describe("SelectionBubble", () => {
  it("renders nothing when rect is null", () => {
    const { container } = render(<SelectionBubble rect={null} onClick={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders button and positions above rect", () => {
    render(<SelectionBubble rect={makeRect(200, 40, 100)} onClick={() => {}} />);
    const el = screen.getByTestId("selection-bubble") as HTMLElement;
    expect(el.style.top).toBe("160px");
    expect(el.style.left).toBe("90px");
    expect(screen.getByRole("button").textContent).toMatch(/重写选中/);
  });

  it("fires onClick", () => {
    const spy = vi.fn();
    render(<SelectionBubble rect={makeRect()} onClick={spy} />);
    fireEvent.click(screen.getByRole("button"));
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

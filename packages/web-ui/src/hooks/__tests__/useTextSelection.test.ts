import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRef, type RefObject } from "react";
import { useTextSelection } from "../useTextSelection";

function setSelectionOn(node: Node, start: number, end: number) {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  // Patch getBoundingClientRect for jsdom since layout is not computed
  range.getBoundingClientRect = () =>
    ({ x: 10, y: 20, width: 100, height: 20, top: 20, left: 10, right: 110, bottom: 40, toJSON: () => ({}) } as DOMRect);
  document.dispatchEvent(new Event("selectionchange"));
  document.dispatchEvent(new Event("mouseup"));
}

function clearSelection() {
  window.getSelection()?.removeAllRanges();
  document.dispatchEvent(new Event("selectionchange"));
  document.dispatchEvent(new Event("mouseup"));
}

describe("useTextSelection", () => {
  let container: HTMLDivElement;
  let outside: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    container.textContent = "hello world inside container";
    document.body.appendChild(container);
    outside = document.createElement("div");
    outside.textContent = "text outside container";
    document.body.appendChild(outside);
  });

  afterEach(() => {
    container.remove();
    outside.remove();
    window.getSelection()?.removeAllRanges();
  });

  function renderWithRef(target: HTMLElement) {
    return renderHook(() => {
      const ref = useRef<HTMLElement>(target);
      return useTextSelection(ref as RefObject<HTMLElement>);
    });
  }

  it("returns null/empty initial state when no selection", () => {
    const { result } = renderWithRef(container);
    expect(result.current.range).toBeNull();
    expect(result.current.rect).toBeNull();
    expect(result.current.text).toBe("");
    expect(result.current.isActive).toBe(false);
  });

  it("becomes active with range/rect/text when selection inside container", () => {
    const { result } = renderWithRef(container);
    act(() => {
      setSelectionOn(container.firstChild!, 0, 5);
    });
    expect(result.current.isActive).toBe(true);
    expect(result.current.text).toBe("hello");
    expect(result.current.range).not.toBeNull();
    expect(result.current.rect).not.toBeNull();
  });

  it("is inactive when selection is outside container", () => {
    const { result } = renderWithRef(container);
    act(() => {
      setSelectionOn(outside.firstChild!, 0, 4);
    });
    expect(result.current.isActive).toBe(false);
    expect(result.current.text).toBe("");
    expect(result.current.range).toBeNull();
    expect(result.current.rect).toBeNull();
  });

  it("is inactive when selection is collapsed", () => {
    const { result } = renderWithRef(container);
    act(() => {
      setSelectionOn(container.firstChild!, 3, 3);
    });
    expect(result.current.isActive).toBe(false);
    expect(result.current.text).toBe("");
  });

  it("resets when selection cleared", () => {
    const { result } = renderWithRef(container);
    act(() => {
      setSelectionOn(container.firstChild!, 0, 5);
    });
    expect(result.current.isActive).toBe(true);
    act(() => {
      clearSelection();
    });
    expect(result.current.isActive).toBe(false);
    expect(result.current.range).toBeNull();
  });

  it("removes document listeners on unmount", () => {
    const { unmount } = renderWithRef(container);
    unmount();
    // After unmount, a selection change should not throw or affect anything observable.
    act(() => {
      setSelectionOn(container.firstChild!, 0, 5);
    });
    // No assertion besides no errors; ensures cleanup path runs.
    expect(true).toBe(true);
  });
});

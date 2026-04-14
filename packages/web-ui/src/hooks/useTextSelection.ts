import { useEffect, useState, type RefObject } from "react";

export interface TextSelectionState {
  range: Range | null;
  rect: DOMRect | null;
  text: string;
  isActive: boolean;
}

const EMPTY: TextSelectionState = {
  range: null,
  rect: null,
  text: "",
  isActive: false,
};

/**
 * Tracks the current document selection and reports whether it lies within
 * the element referenced by `containerRef`. Listens to `mouseup` and
 * `selectionchange` on `document`, cleaning up on unmount.
 */
export function useTextSelection(
  containerRef: RefObject<HTMLElement | null>,
): TextSelectionState {
  const [state, setState] = useState<TextSelectionState>(EMPTY);

  useEffect(() => {
    const compute = () => {
      const sel = typeof window !== "undefined" ? window.getSelection() : null;
      const container = containerRef.current;
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !container) {
        setState((prev) => (prev === EMPTY ? prev : EMPTY));
        return;
      }
      const range = sel.getRangeAt(0);
      const text = sel.toString();
      if (!text) {
        setState((prev) => (prev === EMPTY ? prev : EMPTY));
        return;
      }
      const contained =
        container.contains(range.startContainer) &&
        container.contains(range.endContainer);
      if (!contained) {
        setState((prev) => (prev === EMPTY ? prev : EMPTY));
        return;
      }
      const rect = range.getBoundingClientRect();
      setState({ range, rect, text, isActive: true });
    };

    document.addEventListener("mouseup", compute);
    document.addEventListener("selectionchange", compute);
    // Initial sync in case a selection already exists.
    compute();
    return () => {
      document.removeEventListener("mouseup", compute);
      document.removeEventListener("selectionchange", compute);
    };
  }, [containerRef]);

  return state;
}

import type { CSSProperties } from "react";

export interface SelectionBubbleProps {
  rect: DOMRect | null;
  onClick: () => void;
}

export function SelectionBubble({ rect, onClick }: SelectionBubbleProps) {
  if (!rect) return null;
  const style: CSSProperties = {
    position: "fixed",
    top: Math.max(8, rect.top - 40),
    left: rect.left + rect.width / 2,
    transform: "translateX(-50%)",
    zIndex: 40,
  };
  return (
    <div style={style} data-testid="selection-bubble">
      <button
        type="button"
        onClick={onClick}
        className="px-3 py-1 rounded-md bg-slate-900 text-white text-xs shadow-lg hover:bg-slate-700"
      >
        ✍️ 重写选中
      </button>
    </div>
  );
}

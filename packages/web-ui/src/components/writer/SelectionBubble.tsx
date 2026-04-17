import type { CSSProperties } from 'react';

export interface SelectionBubbleProps {
  rect: DOMRect | null;
  onClick: () => void;
}

export function SelectionBubble({ rect, onClick }: SelectionBubbleProps) {
  if (!rect) return null;
  const style: CSSProperties = {
    position: 'fixed',
    top: Math.max(8, rect.top - 40),
    left: rect.left + rect.width / 2,
    transform: 'translateX(-50%)',
    zIndex: 40,
  };
  return (
    <div style={style} data-testid="selection-bubble">
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--accent)] text-[var(--accent-on,white)] text-xs font-medium shadow-md hover:brightness-110 active:brightness-95"
      >
        <span>✍️</span>
        <span>重写选中</span>
      </button>
    </div>
  );
}

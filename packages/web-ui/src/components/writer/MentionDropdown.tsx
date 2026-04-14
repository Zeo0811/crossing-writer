import type { SuggestItem } from "../../api/writer-client.js";

export interface MentionDropdownProps {
  items: SuggestItem[];
  activeIndex: number;
  onSelect: (item: SuggestItem) => void;
  onHover: (index: number) => void;
}

const MAX_ROWS = 12;
const EXCERPT_MAX = 60;

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max);
}

export function MentionDropdown({ items, activeIndex, onSelect, onHover }: MentionDropdownProps) {
  if (!items || items.length === 0) return null;
  const rows = items.slice(0, MAX_ROWS);
  return (
    <ul
      data-testid="mention-dropdown"
      role="listbox"
      className="absolute z-50 min-w-[280px] max-w-[480px] max-h-72 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg py-1 text-sm"
    >
      {rows.map((item, i) => {
        const isActive = i === activeIndex;
        const label =
          item.kind === "wiki"
            ? `[wiki] ${item.title} — ${truncate(item.excerpt ?? "", EXCERPT_MAX)}`
            : `[raw] ${item.published_at ?? ""} · ${item.account ?? ""} · ${item.title}`;
        return (
          <li
            key={`${item.kind}:${item.id}:${i}`}
            data-testid={`mention-row-${i}`}
            role="option"
            aria-selected={isActive ? "true" : "false"}
            onClick={() => onSelect(item)}
            onMouseMove={() => onHover(i)}
            className={
              "px-3 py-1.5 cursor-pointer truncate " +
              (isActive ? "bg-slate-900 text-white" : "bg-white text-slate-800 hover:bg-slate-100")
            }
          >
            {label}
          </li>
        );
      })}
    </ul>
  );
}

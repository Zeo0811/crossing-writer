export interface MentionSkillItem {
  key: string;
  icon: string;
  label: string;
  description: string;
  insertText: string;
}

export interface MentionDropdownProps {
  items: MentionSkillItem[];
  activeIndex: number;
  onSelect: (item: MentionSkillItem) => void;
  onHover: (index: number) => void;
}

export const SKILL_ITEMS: MentionSkillItem[] = [
  {
    key: "search_wiki",
    icon: "🔖",
    label: "search_wiki",
    description: "检索本地 Wiki 条目",
    insertText: "@search_wiki ",
  },
  {
    key: "search_raw",
    icon: "🗞️",
    label: "search_raw",
    description: "检索原始文章库",
    insertText: "@search_raw ",
  },
];

export function MentionDropdown({ items, activeIndex, onSelect, onHover }: MentionDropdownProps) {
  if (!items || items.length === 0) return null;
  return (
    <ul
      data-testid="mention-dropdown"
      role="listbox"
      className="absolute z-50 min-w-[280px] max-w-[480px] overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg py-1 text-sm"
    >
      {items.map((item, i) => {
        const isActive = i === activeIndex;
        return (
          <li
            key={item.key}
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
            <span className="mr-1">{item.icon}</span>
            <span className="font-medium">{item.label}</span>
            <span className={"ml-2 " + (isActive ? "text-slate-200" : "text-slate-500")}>
              {item.description}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

import { useMemo, useState } from "react";
import type { WikiKind, WikiPageMeta } from "../../api/wiki-client";

const KIND_ORDER: WikiKind[] = ["entity", "concept", "case", "observation", "person"];

export interface WikiTreeProps {
  pages: WikiPageMeta[];
  selected: string | null;
  onSelect: (path: string) => void;
}

export function WikiTree({ pages, selected, onSelect }: WikiTreeProps) {
  const grouped = useMemo(() => {
    const m: Record<WikiKind, WikiPageMeta[]> = { entity: [], concept: [], case: [], observation: [], person: [] };
    for (const p of pages) m[p.kind].push(p);
    for (const k of KIND_ORDER) m[k].sort((a, b) => a.title.localeCompare(b.title));
    return m;
  }, [pages]);

  const [collapsed, setCollapsed] = useState<Record<WikiKind, boolean>>({
    entity: false, concept: false, case: false, observation: false, person: false,
  });

  return (
    <div className="overflow-auto h-full p-2 text-sm">
      {KIND_ORDER.map((kind) => (
        <div key={kind} className="mb-2">
          <div
            onClick={() => setCollapsed((c) => ({ ...c, [kind]: !c[kind] }))}
            className="cursor-pointer font-semibold px-2 py-1 bg-[var(--bg-2)] rounded"
          >
            {collapsed[kind] ? "▸" : "▾"} {kind} ({grouped[kind].length})
          </div>
          {!collapsed[kind] && (
            <ul className="list-none m-0 px-4 py-1">
              {grouped[kind].map((p) => (
                <li
                  key={p.path}
                  onClick={() => onSelect(p.path)}
                  className={`cursor-pointer px-1.5 py-0.5 rounded ${selected === p.path ? "bg-[var(--accent-fill)]" : ""}`}
                >
                  {p.title}
                  {p.aliases.length > 0 && <span className="text-xs text-[var(--meta)]"> · {p.aliases.join(", ")}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

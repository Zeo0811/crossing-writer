import type { StylePanelEntry } from "../../api/style-panels-client.js";
import { formatBeijingShort } from "../../utils/time";

export interface StylePanelListProps {
  panels: StylePanelEntry[];
  onRedistill: (id: string) => void;
}

export function StylePanelList({ panels, onRedistill }: StylePanelListProps) {
  if (panels.length === 0) {
    return <div className="text-sm text-[var(--meta)]">尚未蒸馏任何风格面板</div>;
  }
  return (
    <ul className="divide-y border rounded">
      {panels.map((p) => (
        <li key={p.id} className="flex items-center justify-between px-3 py-2 text-sm">
          <span className="font-medium">{p.id}</span>
          <span className="text-xs text-[var(--meta)] flex-1 ml-3">{formatBeijingShort(p.last_updated_at)}</span>
          <button type="button" onClick={() => onRedistill(p.id)} className="px-2 py-1 border rounded text-xs hover:bg-[var(--bg-2)]">
            重新蒸馏
          </button>
        </li>
      ))}
    </ul>
  );
}

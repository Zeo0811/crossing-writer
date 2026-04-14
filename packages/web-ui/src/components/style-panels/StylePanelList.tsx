import type { StylePanelEntry } from "../../api/style-panels-client.js";

export interface StylePanelListProps {
  panels: StylePanelEntry[];
  onRedistill: (id: string) => void;
}

export function StylePanelList({ panels, onRedistill }: StylePanelListProps) {
  if (panels.length === 0) {
    return <div className="empty">尚未蒸馏任何风格面板</div>;
  }
  return (
    <ul className="style-panel-list">
      {panels.map((p) => (
        <li key={p.id}>
          <span className="id">{p.id}</span>
          <span className="date">{p.last_updated_at.slice(0, 10)}</span>
          <button type="button" onClick={() => onRedistill(p.id)}>重新蒸馏</button>
        </li>
      ))}
    </ul>
  );
}

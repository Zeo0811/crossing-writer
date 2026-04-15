import "./ProjectChecklist.css";

export type ChecklistStatus = "done" | "partial" | "blocked" | "todo" | "warning";
export type ChecklistStepId =
  | "brief"
  | "topic"
  | "case"
  | "evidence"
  | "styleBindings"
  | "draft"
  | "review";

export interface ChecklistItem {
  step: ChecklistStepId;
  status: ChecklistStatus;
  reason?: string;
  link?: string;
}

export interface ProjectChecklistProps {
  items: ChecklistItem[];
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onChipClick?: (item: ChecklistItem) => void;
}

const STATUS_ICON: Record<ChecklistStatus, string> = {
  done: "●",
  partial: "◐",
  todo: "○",
  warning: "▣",
  blocked: "◉",
};

const LABEL: Record<ChecklistStepId, string> = {
  brief: "选题简报",
  topic: "主题选定",
  case: "案例策划",
  evidence: "素材",
  styleBindings: "风格绑定",
  draft: "初稿",
  review: "评审",
};

export function ProjectChecklist(props: ProjectChecklistProps) {
  const { items, collapsed, onToggleCollapsed, onChipClick } = props;
  const doneCount = items.filter((i) => i.status === "done").length;
  const total = items.length;

  if (collapsed) {
    return (
      <div
        className="checklist-row"
        data-testid="project-checklist"
        data-collapsed="1"
      >
        <button
          type="button"
          className="checklist-summary"
          data-testid="checklist-summary"
          onClick={onToggleCollapsed}
        >
          {doneCount}/{total} 已完成
        </button>
        <button
          type="button"
          className="checklist-toggle"
          data-testid="checklist-toggle"
          onClick={onToggleCollapsed}
          aria-label="展开"
        >
          ▼ 展开
        </button>
      </div>
    );
  }

  return (
    <div
      className="checklist-row"
      data-testid="project-checklist"
      data-collapsed="0"
    >
      {items.map((item) => (
        <button
          type="button"
          key={item.step}
          className="checklist-chip"
          data-testid={`checklist-chip-${item.step}`}
          data-status={item.status}
          title={item.reason ?? LABEL[item.step]}
          onClick={() => onChipClick?.(item)}
        >
          <span className="checklist-icon" aria-hidden>
            {STATUS_ICON[item.status]}
          </span>
          <span>{LABEL[item.step]}</span>
          {item.reason ? (
            <span role="tooltip" style={{ display: "none" }}>
              {item.reason}
            </span>
          ) : null}
        </button>
      ))}
      <button
        type="button"
        className="checklist-toggle"
        data-testid="checklist-toggle"
        onClick={onToggleCollapsed}
        aria-label="折叠"
      >
        ▲ 折叠
      </button>
    </div>
  );
}

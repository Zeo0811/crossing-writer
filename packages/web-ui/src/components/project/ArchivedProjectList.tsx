import { Link } from "react-router-dom";
import type { Project } from "../../api/types";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { Chip } from "../ui/Chip";
import { formatBeijingShort } from "../../utils/time";

export interface ArchivedProjectListProps {
  items: Project[];
  onRestore: (id: string) => void;
  onDelete: (project: Project) => void;
}

export function ArchivedProjectList({ items, onRestore, onDelete }: ArchivedProjectListProps) {
  if (items.length === 0) {
    return (
      <div className="text-meta text-[13px] py-10 text-center" data-testid="archived-empty">
        暂无已归档项目
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4" data-testid="archived-grid">
      {items.map((p) => (
        <Card
          key={p.id}
          variant="agent"
          data-testid="archived-card"
          className="opacity-70"
        >
          <div className="flex justify-between items-start gap-2">
            <Link
              to={`/projects/${p.id}`}
              className="font-semibold text-[14px] text-heading no-underline hover:text-accent"
            >
              {p.name}
            </Link>
            <Chip variant="legacy">已归档</Chip>
          </div>
          <div className="font-mono-term text-[11px] text-meta tracking-[0.04em]">
            {p.stage} · 更新于 {formatBeijingShort(p.updated_at)}
          </div>
          <div className="flex gap-2 mt-3">
            <Button variant="secondary" onClick={() => onRestore(p.id)}>
              恢复
            </Button>
            <Button variant="secondary" onClick={() => onDelete(p)}>
              硬删
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}

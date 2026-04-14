import { useMemo } from "react";
import { retryFailed } from "../../api/writer-client";
import { useProjectStream } from "../../hooks/useProjectStream";

export interface WriterProgressPanelProps {
  projectId: string;
  sectionsPlanned: string[];
  status: string;
}

type CardState = "pending" | "running" | "completed" | "failed";

interface SectionCard {
  sectionKey: string;
  state: CardState;
  agent?: string;
  cli?: string;
  model?: string;
  durationMs?: number;
  error?: string;
}

export function WriterProgressPanel({ projectId, sectionsPlanned, status }: WriterProgressPanelProps) {
  const { events } = useProjectStream(projectId);

  const cards: SectionCard[] = useMemo(() => {
    const map = new Map<string, SectionCard>();
    for (const k of sectionsPlanned) map.set(k, { sectionKey: k, state: "pending" });
    for (const ev of events) {
      const data = (ev.data ?? ev) as any;
      const key = data.section_key as string | undefined;
      if (!key) continue;
      const card = map.get(key) ?? { sectionKey: key, state: "pending" };
      if (ev.type === "writer.section_started") {
        card.state = "running";
        card.agent = data.agent; card.cli = data.cli; card.model = data.model;
      } else if (ev.type === "writer.section_completed") {
        card.state = "completed";
        card.agent = data.agent; card.durationMs = data.duration_ms;
      } else if (ev.type === "writer.section_failed") {
        card.state = "failed"; card.agent = data.agent; card.error = data.error;
      }
      map.set(key, card);
    }
    return [...map.values()];
  }, [events, sectionsPlanned]);

  const labelOf = (s: CardState) => s === "running" ? "运行中" : s === "completed" ? "已完成" : s === "failed" ? "失败" : "等待";

  return (
    <div className="flex flex-col gap-2 p-4">
      {cards.map((c) => (
        <div key={c.sectionKey} className={`border rounded p-3 ${c.state === "failed" ? "bg-red-50" : c.state === "completed" ? "bg-green-50" : c.state === "running" ? "bg-blue-50" : "bg-gray-50"}`}>
          <div className="flex justify-between">
            <span>{c.sectionKey}</span>
            <span data-testid={`section-status-${c.sectionKey}`}>{labelOf(c.state)}</span>
          </div>
          <div className="text-xs text-gray-600" title={c.agent ?? undefined}>
            {c.cli && `${c.cli}/${c.model ?? ""}`}
            {c.durationMs !== undefined && ` · ${(c.durationMs / 1000).toFixed(1)}s`}
          </div>
          {c.error && <div className="text-red-600 text-sm">{c.error}</div>}
        </div>
      ))}
      {status === "writing_failed" && (
        <button onClick={() => retryFailed(projectId)} className="mt-2 px-4 py-2 bg-red-600 text-white rounded" aria-label="重跑失败段">
          重试
        </button>
      )}
    </div>
  );
}

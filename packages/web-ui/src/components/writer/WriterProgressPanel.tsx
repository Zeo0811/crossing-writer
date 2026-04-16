import { useMemo } from "react";
import { retryFailed } from "../../api/writer-client";
import { useProjectStream } from "../../hooks/useProjectStream";
import { Button } from "../ui";

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

const SECTION_LABEL: Record<string, string> = {
  opening: "开篇",
  closing: "收束",
};
function label(key: string): string {
  if (SECTION_LABEL[key]) return SECTION_LABEL[key]!;
  if (key.startsWith("practice.case-")) return `Case ${parseInt(key.slice("practice.case-".length), 10)}`;
  return key;
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
        delete card.error;
      } else if (ev.type === "writer.section_completed") {
        card.state = "completed";
        card.agent = data.agent; card.durationMs = data.duration_ms;
        delete card.error;
      } else if (ev.type === "writer.section_failed") {
        card.state = "failed"; card.agent = data.agent; card.error = data.error;
      }
      map.set(key, card);
    }
    return [...map.values()];
  }, [events, sectionsPlanned]);

  return (
    <div className="space-y-2">
      {cards.map((c) => {
        const color =
          c.state === "running" ? "var(--amber)" :
          c.state === "completed" ? "var(--accent)" :
          c.state === "failed" ? "var(--red)" : "var(--faint)";
        const stateLabel =
          c.state === "running" ? "运行中" :
          c.state === "completed" ? "已完成" :
          c.state === "failed" ? "失败" : "等待";
        return (
          <div
            key={c.sectionKey}
            className={`rounded p-3 flex items-center gap-3 ${
              c.state === "failed" ? "bg-[rgba(255,107,107,0.08)] border border-[var(--red)]"
              : c.state === "completed" ? "bg-[var(--accent-fill)]"
              : c.state === "running" ? "bg-[var(--bg-2)]"
              : "bg-[var(--bg-2)]"
            }`}
          >
            <span
              className={`w-5 h-5 rounded-sm flex items-center justify-center text-[10px] font-semibold ${
                c.state === "completed" ? "bg-[var(--accent)] text-[var(--accent-on)]"
                : c.state === "running" ? "bg-[var(--amber)] text-[var(--accent-on)] animate-pulse"
                : c.state === "failed" ? "bg-[var(--red)] text-white"
                : "bg-[var(--bg-1)] text-[var(--faint)]"
              }`}
            >
              {c.state === "completed" ? "✓" : c.state === "failed" ? "✗" : "…"}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-[var(--heading)]">{label(c.sectionKey)}</div>
              <div className="text-xs text-[var(--meta)]" style={{ fontFamily: "var(--font-mono)" }}>
                {c.cli && `${c.cli}/${c.model ?? ""}`}
                {c.durationMs !== undefined && ` · ${(c.durationMs / 1000).toFixed(1)}s`}
              </div>
            </div>
            <span className="text-xs shrink-0" style={{ color }} data-testid={`section-status-${c.sectionKey}`}>
              {stateLabel}
            </span>
            {c.error && <div className="text-xs text-[var(--red)] w-full mt-1">{c.error}</div>}
          </div>
        );
      })}
      {status === "writing_failed" && (
        <div className="flex justify-end mt-2">
          <Button variant="danger" onClick={() => retryFailed(projectId)} aria-label="重跑失败段">
            重试失败段
          </Button>
        </div>
      )}
    </div>
  );
}

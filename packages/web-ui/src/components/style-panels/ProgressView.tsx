import { useEffect, useRef, useState } from "react";
import { startRoleDistillStream, type DistillRole } from "../../api/style-panels-client.js";

export interface ProgressViewProps {
  account: string;
  body: { role: DistillRole; limit?: number };
  onDone: () => void;
}

const PHASE_LABEL: Record<string, string> = {
  "distill.started": "[1/4] 启动",
  "distill.slicer_progress": "[2/4] slicer",
  "distill.slicer_cache_hit": "[2/4] slicer（缓存）",
  "distill.snippets_done": "[3/4] snippets",
  "distill.structure_done": "[3/4] structure",
  "distill.composer_done": "[4/4] composer",
};

export function ProgressView({ account, body, onDone }: ProgressViewProps) {
  const [lines, setLines] = useState<string[]>([]);
  const [finished, setFinished] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        await startRoleDistillStream(
          { account, role: body.role, limit: body.limit },
          (ev) => {
            const label = PHASE_LABEL[ev.type] ?? ev.type;
            if (ev.type === "distill.started") {
              setLines((xs) => [...xs, `${label} · ${ev.data.role} · run=${(ev.data.run_id ?? "").slice(0, 12)}…`]);
            } else if (ev.type === "distill.slicer_progress") {
              setLines((xs) => [...xs, `  ${label} → ${ev.data.processed}/${ev.data.total}`]);
            } else if (ev.type === "distill.slicer_cache_hit") {
              setLines((xs) => [...xs, `  ${label} → ${(ev.data.article_id ?? "").slice(0, 12)}…`]);
            } else if (ev.type === "distill.snippets_done") {
              setLines((xs) => [...xs, `${label} · ${ev.data.count} 条 snippet`]);
            } else if (ev.type === "distill.structure_done") {
              setLines((xs) => [...xs, `${label} · 完成`]);
            } else if (ev.type === "distill.composer_done") {
              setLines((xs) => [...xs, `${label} · ${ev.data.panel_path}`]);
            } else if (ev.type === "distill.finished") {
              setLines((xs) => [...xs, `✓ 完成：${ev.data.panel_path} (v${ev.data.version})`]);
              setFinished(true);
              onDone();
            } else if (ev.type === "distill.failed") {
              setLines((xs) => [...xs, `✗ 失败：${ev.data.error}`]);
            }
          },
        );
      } catch (e) {
        setLines((xs) => [...xs, `ERROR: ${(e as Error).message}`]);
      }
    })();
  }, [account, body, onDone]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold text-[var(--heading)]">
          蒸馏 {account} · <span className="text-[var(--accent)] font-mono-term text-sm">{body.role}</span>
        </h2>
        {!finished && <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />}
      </div>
      <pre className="bg-[var(--bg-0)] text-[var(--body)] text-xs font-mono-term p-4 rounded border border-[var(--hair)] overflow-auto max-h-[60vh] whitespace-pre-wrap leading-relaxed">
        {lines.join("\n") || "等待开始…"}
      </pre>
    </div>
  );
}

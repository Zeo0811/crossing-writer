import { useEffect, useRef, useState } from "react";
import {
  startAllRolesDistillReturningRunId,
  streamDistillRun,
} from "../../api/style-panels-client.js";

type DistillRole = 'opening' | 'practice' | 'closing';

export interface ProgressViewProps {
  account: string;
  body: { roles: DistillRole[]; limit?: number };
  runId?: string;
  onDone: () => void;
}

export function ProgressView({ account, body, runId, onDone }: ProgressViewProps) {
  const [lines, setLines] = useState<string[]>([]);
  const [finished, setFinished] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const appendEvent = (ev: { type: string; data: any }) => {
      setLines((xs) => [...xs, formatLine(ev)]);
      if (ev.type === 'distill.finished') {
        setFinished(true);
        onDone();
      }
    };

    if (runId) {
      setLines((xs) => [...xs, `重连蒸馏任务 run=${runId.slice(0, 16)}…`]);
      const unsub = streamDistillRun(runId, appendEvent);
      return () => { unsub(); };
    }

    let unsub: (() => void) | null = null;
    (async () => {
      try {
        setLines((xs) => [...xs, `启动：${account}（目标 ${body.limit ?? 50} 篇，三角色并行）`]);
        const { run_id } = await startAllRolesDistillReturningRunId({ account, limit: body.limit });
        setLines((xs) => [...xs, `run_id=${run_id}`]);
        unsub = streamDistillRun(run_id, appendEvent);
      } catch (err) {
        setLines((xs) => [...xs, `ERROR: ${(err as Error).message}`]);
      }
    })();

    return () => { if (unsub) unsub(); };
  }, [account, body.limit, runId, onDone]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold text-[var(--heading)]">
          蒸馏 {account}
        </h2>
        {!finished && <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />}
      </div>
      <pre className="bg-[var(--bg-0)] text-[var(--body)] text-xs font-mono-term p-4 rounded border border-[var(--hair)] overflow-auto max-h-[60vh] whitespace-pre-wrap leading-relaxed">
        {lines.join("\n") || "等待开始…"}
      </pre>
    </div>
  );
}

function formatLine(ev: { type: string; data: any }): string {
  const d = ev.data ?? {};
  switch (ev.type) {
    case 'distill.started':
      return `[1/4] 启动 · account=${d.account} · sample_size=${d.sample_size}`;
    case 'sampling.done':
      return `[1/4] 采样完成 · ${d.actual_count} 篇`;
    case 'labeling.article_done':
      return `  [2/4] label ${d.progress} · ${d.id?.slice(0, 12) ?? '?'}… → ${d.type}`;
    case 'labeling.all_done':
      return `[2/4] 全部文章打标完成`;
    case 'aggregation.done':
      return `[3/4] 聚合完成 · ${d.buckets_count} buckets`;
    case 'composer.started':
      return `[4/4] composer 启动 · ${d.role}`;
    case 'composer.done':
      return `[4/4] composer 完成 · ${d.role} → ${d.panel_path}`;
    case 'distill.finished':
      return `✓ 全部完成 · 写了 ${(d.files ?? []).length} 个 panel 文件`;
    case 'distill.failed':
      return `✗ 失败：${d.error}`;
    default:
      return '';
  }
}

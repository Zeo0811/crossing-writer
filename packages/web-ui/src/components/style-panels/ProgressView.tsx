import { useEffect, useRef, useState } from "react";
import {
  startRoleDistillStream,
  startAllRolesDistillStream,
  type DistillRole,
} from "../../api/style-panels-client.js";

export interface ProgressViewProps {
  account: string;
  body: { roles: DistillRole[]; limit?: number };
  onDone: () => void;
}

const ROLE_LABEL: Record<DistillRole, string> = {
  opening: "开头",
  practice: "Case",
  closing: "结尾",
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
        const roles = body.roles;
        if (roles.length === 3) {
          // All three — use the combined endpoint, shared slicer pass
          setLines((xs) => [...xs, `启动：全量 3 个角色（${account}，共享 slicer 加速）`]);
          await startAllRolesDistillStream(
            { account, limit: body.limit },
            (ev) => handleEvent(ev, setLines),
          );
          setLines((xs) => [...xs, `✓ 全部完成`]);
          setFinished(true);
          onDone();
        } else {
          // Partial — loop single-role endpoint per role
          for (const role of roles) {
            setLines((xs) => [...xs, `── 开始 ${ROLE_LABEL[role]} (${role}) ──`]);
            await startRoleDistillStream(
              { account, role, limit: body.limit },
              (ev) => handleEvent(ev, setLines),
            );
          }
          setLines((xs) => [...xs, `✓ 全部完成`]);
          setFinished(true);
          onDone();
        }
      } catch (e) {
        setLines((xs) => [...xs, `ERROR: ${(e as Error).message}`]);
      }
    })();
  }, [account, body, onDone]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold text-[var(--heading)]">
          蒸馏 {account} · <span className="text-[var(--accent)] font-mono-term text-sm">{body.roles.join(" / ")}</span>
        </h2>
        {!finished && <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />}
      </div>
      <pre className="bg-[var(--bg-0)] text-[var(--body)] text-xs font-mono-term p-4 rounded border border-[var(--hair)] overflow-auto max-h-[60vh] whitespace-pre-wrap leading-relaxed">
        {lines.join("\n") || "等待开始…"}
      </pre>
    </div>
  );
}

function handleEvent(
  ev: { type: string; data: any },
  setLines: React.Dispatch<React.SetStateAction<string[]>>,
) {
  const append = (s: string) => setLines((xs) => [...xs, s]);
  switch (ev.type) {
    case "distill.started":
      append(`[1/4] 启动 · ${ev.data.role} · run=${(ev.data.run_id ?? "").slice(0, 12)}…`);
      break;
    case "distill.slicer_progress":
    case "slicer_progress":
      append(`  [2/4] slicer → ${ev.data.processed}/${ev.data.total}`);
      break;
    case "distill.slicer_cache_hit":
    case "slicer_cache_hit":
      append(`  [2/4] slicer（缓存）${(ev.data.article_id ?? "").slice(0, 12)}…`);
      break;
    case "distill.snippets_done":
      append(`[3/4] snippets · ${ev.data.count} 条`);
      break;
    case "distill.structure_done":
      append(`[3/4] structure · 完成`);
      break;
    case "distill.composer_done":
      append(`[4/4] composer · ${ev.data.panel_path}`);
      break;
    case "distill.finished":
      append(`✓ ${ev.data.panel_path} (v${ev.data.version})`);
      break;
    case "distill.failed":
      append(`✗ 失败：${ev.data.error}`);
      break;
    case "distill_all.started":
      append(`启动全量蒸馏 · run=${(ev.data.run_id ?? "").slice(0, 12)}…`);
      break;
    case "role_started":
      append(`── 角色 ${ev.data.role} ──`);
      break;
    case "role_done":
      append(`✓ ${ev.data.role} → ${ev.data.panel_path} (v${ev.data.version})`);
      break;
    case "role_failed":
      append(`✗ ${ev.data.role} 失败：${ev.data.error}`);
      break;
    case "distill_all.finished":
      break; // caller will append overall success line
    case "distill_all.failed":
      append(`✗ 全量失败：${ev.data.error}`);
      break;
    default:
      // silent for unknown events
      break;
  }
}

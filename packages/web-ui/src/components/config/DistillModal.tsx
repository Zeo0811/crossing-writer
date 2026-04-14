import { useCallback, useEffect, useRef, useState } from "react";
import {
  distillStylePanel,
  distillAllRoles,
  type DistillStylePanelStream,
  type StyleBindingRole,
} from "../../api/writer-client.js";

export type DistillModalRole = StyleBindingRole | "all";

export interface DistillModalSingleSuccess {
  version: number;
  path: string;
}

export interface DistillModalAllSuccess {
  results: Array<{ role: StyleBindingRole; version?: number; path?: string; error?: string }>;
}

export interface DistillModalProps {
  account: string;
  role: DistillModalRole;
  onClose: () => void;
  onSuccess: (info: DistillModalSingleSuccess | DistillModalAllSuccess) => void;
}

type Phase = "idle" | "running" | "done" | "failed";

interface SlicerProgress {
  processed: number;
  total: number;
}

type RoleStatus = "WAITING" | "RUNNING" | "DONE" | "FAILED";
const ALL_ROLES: StyleBindingRole[] = ["opening", "practice", "closing"];

export function DistillModal({ account, role, onClose, onSuccess }: DistillModalProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [slicer, setSlicer] = useState<SlicerProgress | null>(null);
  const [composerDone, setComposerDone] = useState(false);
  const [cachedCount, setCachedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState<number>(10);
  const [roleStatus, setRoleStatus] = useState<Record<StyleBindingRole, RoleStatus>>({
    opening: "WAITING",
    practice: "WAITING",
    closing: "WAITING",
  });
  const [roleError, setRoleError] = useState<Partial<Record<StyleBindingRole, string>>>({});
  const streamRef = useRef<DistillStylePanelStream | null>(null);
  const isAll = role === "all";

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.close();
        streamRef.current = null;
      }
    };
  }, []);

  const startDistill = useCallback(() => {
    setPhase("running");
    setSlicer(null);
    setComposerDone(false);
    setCachedCount(0);
    setError(null);
    setRoleStatus({ opening: "WAITING", practice: "WAITING", closing: "WAITING" });
    setRoleError({});

    if (isAll) {
      const s = distillAllRoles(account, limit);
      streamRef.current = s;
      s.onEvent((ev) => {
        if (ev.type === "distill_all.started") {
          setPhase("running");
        } else if (ev.type === "slicer_progress") {
          const processed = Number(ev.data?.processed ?? 0);
          const total = Number(ev.data?.total ?? 0);
          setSlicer({ processed, total });
        } else if (ev.type === "slicer_cache_hit") {
          // SP-15: distill-all surfaces cache hits via bare "slicer_cache_hit".
          setCachedCount((n) => n + 1);
        } else if (ev.type === "role_started") {
          const r = ev.data?.role as StyleBindingRole | undefined;
          if (r) setRoleStatus((prev) => ({ ...prev, [r]: "RUNNING" }));
        } else if (ev.type === "role_done") {
          const r = ev.data?.role as StyleBindingRole | undefined;
          if (r) setRoleStatus((prev) => ({ ...prev, [r]: "DONE" }));
        } else if (ev.type === "role_failed") {
          const r = ev.data?.role as StyleBindingRole | undefined;
          if (r) {
            setRoleStatus((prev) => ({ ...prev, [r]: "FAILED" }));
            setRoleError((prev) => ({ ...prev, [r]: ev.data?.error ?? ev.error ?? "failed" }));
          }
        } else if (ev.type === "distill_all.finished") {
          setPhase("done");
          const results = (ev.data?.results ?? []) as Array<any>;
          onSuccess({
            results: results.map((r) => ({
              role: r.role,
              version: r.version,
              path: r.panel_path,
              error: r.error,
            })),
          });
        } else if (ev.type === "distill_all.failed") {
          setPhase("failed");
          setError(ev.error ?? ev.data?.error ?? "unknown error");
        }
      });
      return;
    }

    const s = distillStylePanel(account, role as StyleBindingRole, limit);
    streamRef.current = s;
    s.onEvent((ev) => {
      if (ev.type === "distill.started") {
        setPhase("running");
      } else if (ev.type === "distill.slicer_progress") {
        const processed = Number(ev.data?.processed ?? 0);
        const total = Number(ev.data?.total ?? 0);
        setSlicer({ processed, total });
      } else if (ev.type === "distill.slicer_cache_hit") {
        // SP-15: each article whose slicer output was cached yields one event.
        setCachedCount((n) => n + 1);
      } else if (ev.type === "distill.composer_done") {
        setComposerDone(true);
      } else if (ev.type === "distill.finished") {
        const version = Number(ev.data?.version ?? 0);
        const path = String(ev.data?.panel_path ?? "");
        setPhase("done");
        onSuccess({ version, path });
      } else if (ev.type === "distill.failed") {
        setPhase("failed");
        setError(ev.error ?? ev.data?.error ?? "unknown error");
      }
    });
  }, [account, role, onSuccess, limit, isAll]);

  const handleCancel = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.close();
      streamRef.current = null;
    }
    onClose();
  }, [onClose]);

  const pct = slicer && slicer.total > 0
    ? Math.round((slicer.processed / slicer.total) * 100)
    : 0;

  const statusColor = (s: RoleStatus) => {
    if (s === "DONE") return "var(--accent)";
    if (s === "FAILED") return "var(--red)";
    if (s === "RUNNING") return "var(--accent)";
    return "var(--faint)";
  };

  return (
    <div
      role="dialog"
      data-testid="distill-modal"
      data-modal-root=""
      className="fixed inset-0 flex items-center justify-center z-50 bg-[rgba(0,0,0,0.55)] backdrop-blur-[6px]"
    >
      <div
        className="p-6 rounded-[6px] border w-[520px] max-w-[90vw] bg-bg-1 border-hair"
      >
        <h3 className="text-base font-semibold mb-3">
          {isAll ? (
            <>
              🎨 蒸馏：<span className="font-mono">{account}</span> /{" "}
              <span className="font-mono">全部 (opening + practice + closing)</span>
            </>
          ) : (
            <>
              🎨 蒸馏：<span className="font-mono">{account}</span> /{" "}
              <span className="font-mono">{role}</span>
            </>
          )}
        </h3>
        <div className="border-t mb-3" style={{ borderColor: "var(--border)" }} />

        <div className="text-sm mb-3">
          <div className="flex items-center gap-2 mb-2">
            <label className="opacity-80">样本数：</label>
            <input
              type="number"
              min={1}
              max={100}
              value={limit}
              disabled={phase !== "idle"}
              onChange={(e) => setLimit(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
              className="w-20 px-2 py-0.5 text-xs border rounded"
              style={{ borderColor: "var(--border)" }}
            />
            <span className="text-xs opacity-60">账号最新 N 篇（MVP 建议 10，省钱；生产建议 50）</span>
          </div>
          <div className="mt-2">流程：</div>
          <ul className="ml-4 mt-1 text-xs leading-5 opacity-90">
            <li>① section-slicer (并发 5{isAll ? "，一次性" : ""})</li>
            {isAll ? (
              <>
                <li>② 按 role 分组 → 3 个 corpora</li>
                <li>③ 3 个角色并行：snippets → structure → composer</li>
                <li>④ 写入 3 份 &lt;role&gt;-v&lt;N+1&gt;.md</li>
              </>
            ) : (
              <>
                <li>② 抽取 {role} 段</li>
                <li>③ snippets → structure → composer</li>
                <li>④ 写入 {role}-v&lt;N+1&gt;.md</li>
              </>
            )}
          </ul>
        </div>

        <div className="text-sm mb-3">
          <div className="mb-1">进度：</div>
          <div className="text-xs font-mono mb-1 flex items-center gap-2">
            <span>
              Slicer:{" "}
              {slicer ? (
                <span>
                  {slicer.processed}/{slicer.total} articles...
                </span>
              ) : (
                <span className="opacity-60">waiting</span>
              )}
            </span>
            {cachedCount > 0 && (
              <span
                data-testid="distill-cached-count"
                className="px-1.5 py-0.5 rounded text-[10px]"
                style={{ background: "var(--bg-2)", color: "var(--accent)" }}
                title="slicer output reused from filesystem cache"
              >
                cached {cachedCount}
              </span>
            )}
          </div>
          <div
            className="h-2 rounded overflow-hidden mb-2"
            style={{ background: "var(--bg-2)" }}
          >
            <div
              data-testid="distill-slicer-bar"
              style={{
                width: `${pct}%`,
                height: "100%",
                background: "var(--accent)",
                transition: "width 150ms linear",
              }}
            />
          </div>
          {isAll ? (
            <div className="text-xs font-mono flex flex-col gap-1" data-testid="distill-roles-status">
              {ALL_ROLES.map((r) => (
                <div key={r} className="flex items-center gap-2">
                  <span className="min-w-[80px]">{r}:</span>
                  <span style={{ color: statusColor(roleStatus[r]) }}>
                    {roleStatus[r]}
                  </span>
                  {roleError[r] && (
                    <span className="opacity-70 text-[10px]">({roleError[r]})</span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs font-mono">
              Composer:{" "}
              {composerDone ? (
                <span style={{ color: "var(--green)" }}>done</span>
              ) : (
                <span className="opacity-60">waiting</span>
              )}
            </div>
          )}
        </div>

        {error && (
          <div
            className="text-xs border rounded p-2 mb-3"
            style={{ borderColor: "var(--red)", color: "var(--red)" }}
          >
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={handleCancel}
            className="px-3 py-1 text-sm border rounded"
            style={{ borderColor: "var(--border)" }}
          >
            取消
          </button>
          {phase === "idle" && (
            <button
              type="button"
              onClick={startDistill}
              className="px-3 py-1 text-sm border rounded"
              style={{ borderColor: "var(--accent)", background: "var(--accent)", color: "var(--accent-on)" }}
            >
              开始蒸馏
            </button>
          )}
          {phase === "running" && (
            <button
              type="button"
              disabled
              className="px-3 py-1 text-sm border rounded opacity-60"
              style={{ borderColor: "var(--border)" }}
            >
              蒸馏中…
            </button>
          )}
          {phase === "failed" && (
            <button
              type="button"
              onClick={startDistill}
              className="px-3 py-1 text-sm border rounded"
              style={{ borderColor: "var(--border)" }}
            >
              重试
            </button>
          )}
          {phase === "done" && (
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1 text-sm border rounded"
              style={{ borderColor: "var(--border)" }}
            >
              关闭
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

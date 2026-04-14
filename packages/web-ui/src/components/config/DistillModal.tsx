import { useCallback, useEffect, useRef, useState } from "react";
import {
  distillStylePanel,
  type DistillStylePanelStream,
  type StyleBindingRole,
} from "../../api/writer-client.js";

export interface DistillModalProps {
  account: string;
  role: StyleBindingRole;
  onClose: () => void;
  onSuccess: (info: { version: number; path: string }) => void;
}

type Phase = "idle" | "running" | "done" | "failed";

interface SlicerProgress {
  processed: number;
  total: number;
}

export function DistillModal({ account, role, onClose, onSuccess }: DistillModalProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [slicer, setSlicer] = useState<SlicerProgress | null>(null);
  const [composerDone, setComposerDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<DistillStylePanelStream | null>(null);

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
    setError(null);
    const s = distillStylePanel(account, role);
    streamRef.current = s;
    s.onEvent((ev) => {
      if (ev.type === "distill.started") {
        setPhase("running");
      } else if (ev.type === "distill.slicer_progress") {
        const processed = Number(ev.data?.processed ?? 0);
        const total = Number(ev.data?.total ?? 0);
        setSlicer({ processed, total });
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
  }, [account, role, onSuccess]);

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

  return (
    <div
      role="dialog"
      data-testid="distill-modal"
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: "rgba(0,0,0,0.5)" }}
    >
      <div
        className="p-6 rounded border w-[520px] max-w-[90vw]"
        style={{ background: "var(--bg, #fff)", borderColor: "var(--border)" }}
      >
        <h3 className="text-base font-semibold mb-3">
          🎨 蒸馏：<span className="font-mono">{account}</span> /{" "}
          <span className="font-mono">{role}</span>
        </h3>
        <div className="border-t mb-3" style={{ borderColor: "var(--border)" }} />

        <div className="text-sm mb-3">
          <div className="opacity-80">源文章：账号最新 50 篇</div>
          <div className="mt-2">流程：</div>
          <ul className="ml-4 mt-1 text-xs leading-5 opacity-90">
            <li>① section-slicer (并发 5)</li>
            <li>② 抽取 {role} 段</li>
            <li>③ snippets → structure → composer</li>
            <li>④ 写入 {role}-v&lt;N+1&gt;.md</li>
          </ul>
        </div>

        <div className="text-sm mb-3">
          <div className="mb-1">进度：</div>
          <div className="text-xs font-mono mb-1">
            Slicer:{" "}
            {slicer ? (
              <span>
                {slicer.processed}/{slicer.total} articles...
              </span>
            ) : (
              <span className="opacity-60">waiting</span>
            )}
          </div>
          <div
            className="h-2 rounded overflow-hidden mb-2"
            style={{ background: "var(--gray-light, #eee)" }}
          >
            <div
              data-testid="distill-slicer-bar"
              style={{
                width: `${pct}%`,
                height: "100%",
                background: "var(--green, #22c55e)",
                transition: "width 150ms linear",
              }}
            />
          </div>
          <div className="text-xs font-mono">
            Composer:{" "}
            {composerDone ? (
              <span style={{ color: "var(--green)" }}>done</span>
            ) : (
              <span className="opacity-60">waiting</span>
            )}
          </div>
        </div>

        {error && (
          <div
            className="text-xs border rounded p-2 mb-3"
            style={{ borderColor: "var(--red, #ef4444)", color: "var(--red, #ef4444)" }}
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
              style={{ borderColor: "var(--border)", background: "var(--green, #22c55e)", color: "#fff" }}
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

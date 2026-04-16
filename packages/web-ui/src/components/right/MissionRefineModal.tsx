import { useEffect, useMemo, useState } from "react";
import { diffLines } from "diff";

function RefiningAnimation({ projectId }: { projectId: string }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--accent)] opacity-60 animate-ping" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[var(--accent)]" />
        </span>
        <div className="flex-1">
          <div className="text-sm font-semibold text-[var(--heading)]">Coordinator 正在根据你的反馈调整立意</div>
          <div className="text-xs text-[var(--meta)] mt-0.5">保留主方向，精修 hook / 角度 / 目标读者感知</div>
        </div>
        <div className="text-xs font-mono-term text-[var(--accent)] tabular-nums">{mm}:{ss}</div>
      </div>

      <div className="space-y-2">
        {[78, 52, 88, 42, 64].map((w, i) => (
          <div key={i} className="h-2.5 rounded-full bg-[var(--bg-1)] overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-[var(--accent-fill)] via-[var(--accent)] to-[var(--accent-fill)] animate-pulse"
              style={{ width: `${w}%`, animationDelay: `${i * 0.15}s`, animationDuration: "1.6s" }}
            />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 text-[11px] text-[var(--faint)] font-mono-term pt-2 border-t border-[var(--hair)]">
        <span className="text-[var(--accent)]">$</span>
        <span>coordinator.refine({`{ project: "${projectId.slice(0, 12)}..." }`})</span>
      </div>
    </div>
  );
}

interface RefineEntry {
  index: number;
  path: string;
  feedback: string;
  created_at: string;
}

export function MissionRefineModal({
  projectId,
  project,
  refetch,
  mode,
}: {
  projectId: string;
  project: any;
  refetch: () => void;
  mode: "preview" | "refining" | "review";
}) {
  const [selected, setSelected] = useState<string>("");
  const [refines, setRefines] = useState<RefineEntry[]>([]);
  const [viewingIndex, setViewingIndex] = useState<number | null>(null);
  const [previousText, setPreviousText] = useState<string>("");
  const [currentText, setCurrentText] = useState<string>("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState<"refine" | "confirm" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Load selected.md (the originally picked candidate) for the preview header
  useEffect(() => {
    (async () => {
      if (!project?.mission?.selected_path) return;
      try {
        const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/mission/selected`);
        if (r.ok) setSelected(await r.text());
      } catch (e: any) { setErr(String(e?.message ?? e)); }
    })();
  }, [projectId, project?.mission?.selected_path]);

  // Load refines list (used in review mode for history dropdown + diff)
  useEffect(() => {
    if (mode !== "review" && mode !== "preview") return;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/mission/refines`);
        const { refines } = await res.json();
        setRefines(refines ?? []);
        if (refines?.length > 0) setViewingIndex(refines[refines.length - 1].index);
      } catch { /* ignore */ }
    })();
  }, [projectId, mode]);

  // Load current + previous refine for diff (review mode)
  useEffect(() => {
    if (mode !== "review" || viewingIndex == null) { setCurrentText(""); setPreviousText(""); return; }
    (async () => {
      try {
        const cur = await fetch(`/api/projects/${encodeURIComponent(projectId)}/mission/refines/${viewingIndex}`);
        if (cur.ok) setCurrentText(await cur.text());
        if (viewingIndex > 1) {
          const prev = await fetch(`/api/projects/${encodeURIComponent(projectId)}/mission/refines/${viewingIndex - 1}`);
          if (prev.ok) setPreviousText(await prev.text());
        } else {
          // first refine: compare against the original selected mission
          setPreviousText(selected);
        }
      } catch { /* ignore */ }
    })();
  }, [projectId, mode, viewingIndex, selected]);

  const diffParts = useMemo(() => {
    if (mode !== "review" || !currentText) return [];
    return diffLines(previousText, currentText);
  }, [mode, previousText, currentText]);

  const submitRefine = async () => {
    setBusy("refine"); setErr(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/mission/refine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback }),
      });
      if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => "")}`);
      setFeedback("");
      refetch();
    } catch (e: any) { setErr(String(e?.message ?? e)); }
    finally { setBusy(null); }
  };

  const confirmFinal = async () => {
    setBusy("confirm"); setErr(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/mission/confirm`, { method: "POST" });
      if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => "")}`);
      refetch();
    } catch (e: any) { setErr(String(e?.message ?? e)); }
    finally { setBusy(null); }
  };

  const title =
    mode === "preview" ? "已选定立意 · 确认或继续打磨" :
    mode === "refining" ? "正在精修立意…" :
    `立意改稿 · 第 ${viewingIndex ?? "?"} 版`;

  return (
    <div
      role="dialog"
      aria-label="立意打磨"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,0.55)] backdrop-blur-sm p-6"
    >
      <div
        className="w-full max-w-[720px] max-h-[90vh] overflow-y-auto flex flex-col rounded-lg border border-[var(--hair)] bg-[var(--bg-1)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {mode !== "refining" && (
          <header className="flex items-center justify-between gap-4 px-6 py-4 border-b border-[var(--hair)]">
            <h2 className="text-base font-semibold text-[var(--heading)]">{title}</h2>
            {mode === "review" && refines.length > 1 && (
              <select
                value={viewingIndex ?? ""}
                onChange={(e) => setViewingIndex(Number(e.target.value))}
                className="h-8 px-2 text-xs rounded border border-[var(--hair)] bg-[var(--bg-1)] text-[var(--body)]"
              >
                {refines.map((r) => (
                  <option key={r.index} value={r.index}>第 {r.index} 次改稿</option>
                ))}
              </select>
            )}
          </header>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4">
          {mode === "refining" ? (
            <RefiningAnimation projectId={projectId} />
          ) : mode === "review" ? (
            <div className="rounded border border-[var(--hair)] bg-[var(--bg-2)] p-4 max-h-[40vh] overflow-auto">
              <div className="text-[10px] uppercase tracking-wider text-[var(--faint)] font-semibold mb-2">改稿对比（上一版 → 当前版）</div>
              {diffParts.length === 0 && <div className="text-xs text-[var(--faint)]">加载中…</div>}
              <pre className="text-sm font-mono-term whitespace-pre-wrap break-words leading-relaxed">
                {diffParts.map((p, i) => (
                  <span
                    key={i}
                    className={
                      p.added ? "bg-[rgba(46,194,126,0.12)] text-[var(--accent)]" :
                      p.removed ? "bg-[rgba(255,107,107,0.10)] text-[var(--red)] line-through" :
                      "text-[var(--body)]"
                    }
                  >
                    {p.value}
                  </span>
                ))}
              </pre>
            </div>
          ) : (
            // preview mode: show selected mission raw
            <div className="rounded border border-[var(--hair)] bg-[var(--bg-2)] p-4 max-h-[40vh] overflow-auto">
              <div className="text-[10px] uppercase tracking-wider text-[var(--faint)] font-semibold mb-2">当前选中立意</div>
              <pre className="text-sm text-[var(--body)] whitespace-pre-wrap break-words font-mono-term leading-relaxed">
                {selected || "加载中…"}
              </pre>
            </div>
          )}

          {mode !== "refining" && (
            <div>
              <label className="block text-xs text-[var(--meta)] mb-1.5">
                {mode === "review" ? "继续调整（可留空）" : "修改意见（可留空）"}
              </label>
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder={mode === "review" ? "再改点什么？" : "想调什么？比如「这个立意太普通了，想更反直觉一些」"}
                className="w-full min-h-[80px] p-3 rounded border border-[var(--hair)] bg-[var(--bg-1)] text-sm text-[var(--body)] outline-none focus:border-[var(--accent-soft)]"
                disabled={!!busy}
              />
            </div>
          )}

          {err && <div className="text-xs text-[var(--red)]">错误：{err}</div>}
        </div>

        {mode !== "refining" && (
          <footer className="flex justify-end gap-2 px-6 py-4 border-t border-[var(--hair)]">
            <button
              type="button"
              disabled={!!busy}
              onClick={submitRefine}
              className="inline-flex items-center h-9 px-4 rounded border border-[var(--hair)] text-sm text-[var(--body)] hover:bg-[var(--bg-2)] disabled:opacity-50"
            >
              {busy === "refine" ? "提交中…" : mode === "review" ? "⬆ 再改一次" : "⬆ 提交修改意见"}
            </button>
            <button
              type="button"
              disabled={!!busy}
              onClick={confirmFinal}
              className="inline-flex items-center h-9 px-4 rounded border border-[var(--accent-soft)] bg-[var(--accent)] text-sm text-[var(--accent-on)] font-semibold hover:shadow-[0_0_12px_var(--accent-dim)] disabled:opacity-50"
            >
              {busy === "confirm" ? "确认中…" : "✓ 确认进入下一步"}
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}

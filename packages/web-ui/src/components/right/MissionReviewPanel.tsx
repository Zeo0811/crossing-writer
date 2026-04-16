import { useEffect, useMemo, useState } from "react";
import { diffLines } from "diff";

interface RefineEntry {
  index: number;
  path: string;
  feedback: string;
  created_at: string;
}

export function MissionReviewPanel({
  projectId,
  project,
  refetch,
}: {
  projectId: string;
  project: any;
  refetch: () => void;
}) {
  const [refines, setRefines] = useState<RefineEntry[]>([]);
  const [viewingIndex, setViewingIndex] = useState<number | null>(null);
  const [previousText, setPreviousText] = useState<string>("");
  const [currentText, setCurrentText] = useState<string>("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState<"refine" | "confirm" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/mission/refines`);
        const { refines } = await res.json();
        setRefines(refines ?? []);
        if (refines?.length > 0) setViewingIndex(refines[refines.length - 1].index);
      } catch (e: any) { setErr(String(e?.message ?? e)); }
    })();
  }, [projectId, project?.mission?.selected_path]);

  useEffect(() => {
    (async () => {
      if (viewingIndex == null) { setCurrentText(""); return; }
      try {
        const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/mission/refines/${viewingIndex}`);
        if (r.ok) setCurrentText(await r.text());
      } catch { /* ignore */ }
    })();
  }, [projectId, viewingIndex]);

  useEffect(() => {
    (async () => {
      if (viewingIndex == null || viewingIndex <= 1) { setPreviousText(""); return; }
      try {
        const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/mission/refines/${viewingIndex - 1}`);
        if (r.ok) setPreviousText(await r.text());
      } catch { /* ignore */ }
    })();
  }, [projectId, viewingIndex]);

  const diffParts = useMemo(() => {
    if (!currentText) return [];
    return diffLines(previousText, currentText);
  }, [previousText, currentText]);

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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[var(--heading)]">立意改稿 · 第 {viewingIndex ?? "?"} 版</div>
        {refines.length > 1 && (
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
      </div>

      <div className="rounded border border-[var(--hair)] bg-[var(--bg-1)] p-4 max-h-[40vh] overflow-auto">
        <div className="text-[10px] uppercase tracking-wider text-[var(--faint)] font-semibold mb-2">改稿对比（上一版 → 当前版）</div>
        {diffParts.length === 0 && <div className="text-xs text-[var(--faint)]">加载中或无上一版可比。</div>}
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

      <div>
        <label className="block text-xs text-[var(--meta)] mb-1.5">继续调整（留空也能再打磨）</label>
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="再改点什么？"
          className="w-full min-h-[80px] p-3 rounded border border-[var(--hair)] bg-[var(--bg-1)] text-sm text-[var(--body)] outline-none focus:border-[var(--accent-soft)]"
          disabled={!!busy}
        />
      </div>

      {err && <div className="text-xs text-[var(--red)]">错误：{err}</div>}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          disabled={!!busy}
          onClick={confirmFinal}
          className="inline-flex items-center h-9 px-4 rounded border border-[var(--hair)] text-sm text-[var(--body)] hover:bg-[var(--bg-2)] disabled:opacity-50"
        >
          {busy === "confirm" ? "确认中…" : "✓ 确认进入下一步"}
        </button>
        <button
          type="button"
          disabled={!!busy}
          onClick={submitRefine}
          className="inline-flex items-center h-9 px-4 rounded border border-[var(--accent-soft)] bg-[var(--accent)] text-sm text-[var(--accent-on)] font-semibold hover:shadow-[0_0_12px_var(--accent-dim)] disabled:opacity-50"
        >
          {busy === "refine" ? "改稿中…" : "⬆ 再改一次"}
        </button>
      </div>
    </div>
  );
}

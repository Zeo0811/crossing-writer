import { useEffect, useState } from "react";

export function MissionApprovePreview({
  projectId,
  project,
  refetch,
}: {
  projectId: string;
  project: any;
  refetch: () => void;
}) {
  const [selected, setSelected] = useState<string>("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState<"refine" | "confirm" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const refinesRes = await fetch(`/api/projects/${encodeURIComponent(projectId)}/mission/refines`);
        if (refinesRes.ok) {
          const { refines } = await refinesRes.json();
          if (refines?.length > 0) {
            const last = refines[refines.length - 1];
            const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/mission/refines/${last.index}`);
            if (r.ok) { setSelected(await r.text()); return; }
          }
        }
        // Fallback: read selected.md via tree API's file endpoint is not available — try to fetch via raw file path is not exposed.
        // So we rely on refines[] being empty → just show a stub message; project.mission.selected_path tells us the path exists.
        if (project?.mission?.selected_path) {
          setSelected("（已选定立意，等待加载完整内容；如空白可点‘提交修改意见’让 coordinator 首次打磨）");
        }
      } catch (e: any) { setErr(String(e?.message ?? e)); }
    })();
  }, [projectId, project?.mission?.selected_path]);

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
      <div className="rounded border border-[var(--hair)] bg-[var(--bg-1)] p-5">
        <div className="text-xs uppercase tracking-wider text-[var(--faint)] font-semibold mb-3">当前选中立意</div>
        <pre className="text-sm text-[var(--body)] whitespace-pre-wrap break-words font-mono-term">{selected || "加载中…"}</pre>
      </div>

      <div>
        <label className="block text-xs text-[var(--meta)] mb-1.5">修改意见（可留空，留空也能提交以再打磨）</label>
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="想调什么？比如「这个立意太普通了，想更反直觉一些」"
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
          {busy === "refine" ? "提交中…" : "⬆ 提交修改意见"}
        </button>
      </div>
    </div>
  );
}

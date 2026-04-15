import { useEffect, useState } from "react";
import { api, apiMission } from "../../api/client";
import type { Expert } from "../../api/types";

export function ExpertSelector({
  projectId,
  onStarted,
}: {
  projectId: string;
  onStarted: () => void;
}) {
  const [experts, setExperts] = useState<Expert[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.listExperts().then((res) => {
      setExperts(res.topic_panel);
      setSelected(new Set(res.topic_panel.filter((e) => e.default_preselect).map((e) => e.name)));
    });
  }, []);

  function toggle(name: string) {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setSelected(next);
  }

  async function start() {
    if (selected.size === 0) { setErr("至少选一位专家"); return; }
    setBusy(true);
    setErr(null);
    try {
      await apiMission.start(projectId, [...selected]);
      onStarted();
    } catch (e: any) { setErr(String(e.message ?? e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {experts.map((e) => {
          const picked = selected.has(e.name);
          return (
            <button
              key={e.name}
              type="button"
              onClick={() => toggle(e.name)}
              className={`text-left rounded p-4 border transition-colors ${
                picked ? "border-[var(--accent)] bg-[var(--accent-fill)]" : "border-[var(--hair)] bg-[var(--bg-1)] hover:border-[var(--accent-soft)]"
              }`}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="font-semibold text-[var(--heading)]">{e.name}</div>
                <span
                  className={`w-4 h-4 rounded-sm border flex items-center justify-center text-[10px] ${
                    picked ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-on)]" : "border-[var(--hair-strong)]"
                  }`}
                >
                  {picked && "✓"}
                </span>
              </div>
              {e.specialty && (
                <p className="text-xs text-[var(--meta)] leading-relaxed">{e.specialty}</p>
              )}
            </button>
          );
        })}
      </div>
      {err && <div className="rounded border border-[var(--red)] bg-[rgba(255,107,107,0.05)] px-3 py-2 text-sm text-[var(--red)]">{err}</div>}
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--meta)]">已选 {selected.size} 位 · 至少 1 位</span>
        <button
          onClick={start}
          disabled={busy}
          className="px-5 py-2 rounded border border-[var(--accent-soft)] bg-[var(--accent)] text-[var(--accent-on)] font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-[0_0_12px_var(--accent-dim)]"
        >
          {busy ? "启动中…" : "启动专家团 →"}
        </button>
      </div>
    </div>
  );
}

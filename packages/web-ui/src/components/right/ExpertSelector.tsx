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
      setSelected(
        new Set(
          res.topic_panel.filter((e) => e.default_preselect).map((e) => e.name),
        ),
      );
    });
  }, []);

  function toggle(name: string) {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setSelected(next);
  }

  async function start() {
    if (selected.size === 0) {
      setErr("至少选一位专家");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await apiMission.start(projectId, [...selected]);
      onStarted();
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="space-y-3 p-4 bg-white rounded border"
      style={{ borderColor: "var(--border)" }}
    >
      <h2 className="font-semibold">选择参与评审的专家</h2>
      <div className="space-y-2">
        {experts.map((e) => (
          <label
            key={e.name}
            className="flex items-start gap-2 p-2 hover:bg-gray-50 rounded cursor-pointer"
          >
            <input
              type="checkbox"
              checked={selected.has(e.name)}
              onChange={() => toggle(e.name)}
            />
            <div>
              <div className="font-medium">{e.name}</div>
              <div className="text-xs text-gray-600">{e.specialty}</div>
            </div>
          </label>
        ))}
      </div>
      <div className="text-sm text-gray-500">已选 {selected.size} 位</div>
      {err && <div className="text-sm text-red-600">{err}</div>}
      <button
        onClick={start}
        disabled={busy}
        className="px-4 py-2 rounded text-white"
        style={{ background: "var(--green)" }}
      >
        {busy ? "启动中…" : "开跑两轮评审"}
      </button>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  deleteStylePanel,
  getAgentConfigs,
  listConfigStylePanels,
  type AgentConfigEntry,
  type StylePanel,
  type StyleBindingRole,
} from "../../api/writer-client.js";
import { DistillModal } from "./DistillModal.js";

type Chip = "active" | "deleted" | "legacy";

function chipLabel(c: Chip) {
  if (c === "active") return "● ACTIVE";
  if (c === "deleted") return "○ DELETED";
  return "▣ LEGACY";
}

function chipColor(c: Chip) {
  if (c === "active") return "var(--green)";
  if (c === "deleted") return "#888";
  return "#d4a72c";
}

export function StylePanelList() {
  const [panels, setPanels] = useState<StylePanel[]>([]);
  const [agents, setAgents] = useState<Record<string, AgentConfigEntry>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [distillTarget, setDistillTarget] = useState<{ account: string; role: StyleBindingRole } | null>(null);

  const refresh = useCallback(async () => {
    const [pl, cfgs] = await Promise.all([
      listConfigStylePanels({ include_deleted: true }),
      getAgentConfigs(),
    ]);
    setPanels(pl.panels);
    setAgents(cfgs.agents);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await refresh();
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [refresh]);

  const grouped = useMemo(() => {
    const map = new Map<string, StylePanel[]>();
    for (const p of panels) {
      const arr = map.get(p.account) ?? [];
      arr.push(p);
      map.set(p.account, arr);
    }
    for (const [, arr] of map) {
      arr.sort((a, b) => {
        if (a.role !== b.role) return a.role.localeCompare(b.role);
        return b.version - a.version;
      });
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [panels]);

  const mountMap = useMemo(() => {
    // key: `${account}::${role}` → [agentKey...]
    const m = new Map<string, string[]>();
    for (const [key, cfg] of Object.entries(agents)) {
      if (!cfg.styleBinding) continue;
      const k = `${cfg.styleBinding.account}::${cfg.styleBinding.role}`;
      const arr = m.get(k) ?? [];
      arr.push(key);
      m.set(k, arr);
    }
    return m;
  }, [agents]);

  const handleDelete = useCallback(
    async (p: StylePanel, hard: boolean) => {
      try {
        await deleteStylePanel(p.account, p.role, p.version, hard);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [refresh],
  );

  const handleRestore = useCallback(async (p: StylePanel) => {
    // TODO(SP-10 T23): call a proper restore API; for MVP this is a placeholder toast.
    window.alert?.(`restore ${p.account}/${p.role}/v${p.version} — coming soon`);
  }, []);

  if (loading) return <div>Loading…</div>;

  return (
    <div>
      {error && <div style={{ color: "var(--red)" }}>Error: {error}</div>}
      {grouped.map(([account, rows]) => (
        <section key={account} className="mb-6">
          <h2 className="text-sm font-semibold mb-2" style={{ color: "var(--green)" }}>
            {account}
          </h2>
          <div className="flex flex-col gap-2">
            {rows.map((p) => {
              const chip: Chip = p.is_legacy ? "legacy" : p.status === "deleted" ? "deleted" : "active";
              const mountedBy = mountMap.get(`${p.account}::${p.role}`) ?? [];
              return (
                <div
                  key={`${p.account}-${p.role}-${p.version}`}
                  className="flex items-center gap-3 border rounded p-3 text-sm"
                  style={{ borderColor: "var(--border)" }}
                >
                  <span className="font-mono min-w-[120px]">
                    {p.role} v{p.version}
                  </span>
                  <span style={{ color: chipColor(chip) }} className="text-xs">
                    {chipLabel(chip)}
                  </span>
                  {chip === "active" && mountedBy.length > 0 && (
                    <span className="text-xs opacity-80">挂载到: {mountedBy.join(", ")}</span>
                  )}
                  {chip === "legacy" && (
                    <span className="text-xs opacity-80">不可绑定 请重蒸</span>
                  )}
                  <span className="flex-1" />
                  {chip !== "legacy" && (
                    <button
                      className="px-2 py-0.5 text-xs border rounded"
                      style={{ borderColor: "var(--border)" }}
                      onClick={() =>
                        setDistillTarget({ account: p.account, role: p.role as StyleBindingRole })
                      }
                    >
                      重蒸
                    </button>
                  )}
                  {chip === "deleted" && (
                    <button
                      className="px-2 py-0.5 text-xs border rounded"
                      style={{ borderColor: "var(--border)" }}
                      onClick={() => { void handleRestore(p); }}
                    >
                      恢复
                    </button>
                  )}
                  {chip === "active" && (
                    <button
                      className="px-2 py-0.5 text-xs border rounded"
                      style={{ borderColor: "var(--border)" }}
                      onClick={() => { void handleDelete(p, false); }}
                    >
                      软删
                    </button>
                  )}
                  <button
                    className="px-2 py-0.5 text-xs border rounded"
                    style={{ borderColor: "var(--border)", color: "var(--red)" }}
                    onClick={() => { void handleDelete(p, true); }}
                  >
                    硬删
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      ))}
      {distillTarget && (
        <DistillModal
          account={distillTarget.account}
          role={distillTarget.role}
          onClose={() => setDistillTarget(null)}
          onSuccess={() => {
            setDistillTarget(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

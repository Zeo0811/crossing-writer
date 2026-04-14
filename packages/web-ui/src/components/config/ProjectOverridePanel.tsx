import { useCallback, useEffect, useMemo, useState } from "react";
import {
  clearProjectAgentOverride,
  getAgentConfigs,
  getProjectOverride,
  listConfigStylePanels,
  setProjectOverride,
  type AgentConfigEntry,
  type AgentModelConfig,
  type AgentStyleBinding,
  type ProjectOverride,
  type StyleBindingRole,
  type StylePanel,
} from "../../api/writer-client.js";

export interface ProjectOverridePanelProps {
  projectId: string;
  onClose: () => void;
}

const WRITER_AGENTS = ["writer.opening", "writer.practice", "writer.closing"] as const;

const MODEL_CHOICES: AgentModelConfig[] = [
  { cli: "claude", model: "claude-opus-4.6" },
  { cli: "claude", model: "claude-sonnet-4.5" },
  { cli: "codex", model: "gpt-5" },
];

function modelKey(m: AgentModelConfig): string {
  return `${m.cli}::${m.model ?? ""}`;
}

function styleKey(b: AgentStyleBinding): string {
  return `${b.account}::${b.role}`;
}

function parseModel(v: string): AgentModelConfig {
  const [cli, model] = v.split("::") as ["claude" | "codex", string];
  return { cli, model: model || undefined };
}

function parseStyle(v: string): AgentStyleBinding {
  const [account, role] = v.split("::") as [string, StyleBindingRole];
  return { account, role };
}

function modelLabel(m: AgentModelConfig): string {
  return `${m.cli} ${m.model ?? "(default)"}`;
}

function styleLabel(b: AgentStyleBinding, version?: number): string {
  return version !== undefined
    ? `${b.account} / ${b.role} v${version}`
    : `${b.account} / ${b.role}`;
}

function writerRole(agentKey: string): StyleBindingRole | null {
  if (agentKey === "writer.opening") return "opening";
  if (agentKey === "writer.practice") return "practice";
  if (agentKey === "writer.closing") return "closing";
  return null;
}

export function ProjectOverridePanel({ projectId, onClose }: ProjectOverridePanelProps) {
  const [defaults, setDefaults] = useState<Record<string, AgentConfigEntry>>({});
  const [override, setOverride] = useState<ProjectOverride>({ agents: {} });
  const [panels, setPanels] = useState<StylePanel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [cfgs, ov, pl] = await Promise.all([
      getAgentConfigs(),
      getProjectOverride(projectId),
      listConfigStylePanels(),
    ]);
    setDefaults(cfgs.agents);
    setOverride(ov ?? { agents: {} });
    setPanels(pl.panels);
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await reload();
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [reload]);

  const stylePanelsByRole = useMemo(() => {
    const m = new Map<StyleBindingRole, StylePanel[]>();
    for (const p of panels) {
      if (p.status !== "active" || p.is_legacy) continue;
      if (p.role === "opening" || p.role === "practice" || p.role === "closing") {
        const arr = m.get(p.role) ?? [];
        arr.push(p);
        m.set(p.role, arr);
      }
    }
    return m;
  }, [panels]);

  const handleModelChange = (agentKey: string, value: string) => {
    setOverride((prev) => {
      const next: ProjectOverride = { agents: { ...prev.agents } };
      const existing = { ...(next.agents[agentKey] ?? {}) };
      if (!value) {
        delete existing.model;
      } else {
        existing.model = parseModel(value);
      }
      if (Object.keys(existing).length === 0) {
        delete next.agents[agentKey];
      } else {
        next.agents[agentKey] = existing;
      }
      return next;
    });
  };

  const handleStyleChange = (agentKey: string, value: string) => {
    setOverride((prev) => {
      const next: ProjectOverride = { agents: { ...prev.agents } };
      const existing = { ...(next.agents[agentKey] ?? {}) };
      if (!value) {
        delete existing.styleBinding;
      } else {
        existing.styleBinding = parseStyle(value);
      }
      if (Object.keys(existing).length === 0) {
        delete next.agents[agentKey];
      } else {
        next.agents[agentKey] = existing;
      }
      return next;
    });
  };

  const handleClear = useCallback(
    async (agentKey: string) => {
      try {
        await clearProjectAgentOverride(projectId, agentKey);
        await reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [projectId, reload],
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await setProjectOverride(projectId, override);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [projectId, override, onClose]);

  if (loading) {
    return (
      <div role="dialog" className="fixed inset-0 flex items-center justify-center bg-[rgba(0,0,0,0.55)] backdrop-blur-[6px]">
        <div className="p-6 bg-bg-1 border border-hair text-body rounded-[6px]">Loading…</div>
      </div>
    );
  }

  return (
    <div
      role="dialog"
      data-testid="project-override-panel"
      data-modal-root=""
      className="fixed inset-0 z-50 flex items-start justify-end bg-[rgba(0,0,0,0.55)] backdrop-blur-[6px]"
    >
      <div
        className="h-full w-[640px] max-w-[95vw] overflow-auto shadow-xl p-5 bg-bg-1 border-l border-hair text-body"
      >
        <header className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold">🔧 本项目专属配置</h2>
          <span className="text-xs opacity-60 font-mono">{projectId}</span>
        </header>

        {error && <div className="text-xs mb-3 text-red">{error}</div>}

        <div className="flex flex-col gap-4">
          {WRITER_AGENTS.map((agentKey) => {
            const defaultCfg = defaults[agentKey];
            if (!defaultCfg) return null;
            const ov = override.agents[agentKey] ?? {};
            const role = writerRole(agentKey);
            const modelValue = ov.model ? modelKey(ov.model) : "";
            const styleValue = ov.styleBinding ? styleKey(ov.styleBinding) : "";
            const hasOverride = Boolean(ov.model || ov.styleBinding || ov.tools || ov.promptVersion);
            const roleChoices = role ? (stylePanelsByRole.get(role) ?? []) : [];

            return (
              <div
                key={agentKey}
                className="border rounded p-3"
                style={{ borderColor: "var(--border)" }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-sm">{agentKey}</span>
                  {hasOverride && (
                    <button
                      type="button"
                      data-testid={`clear-override-${agentKey}`}
                      onClick={() => { void handleClear(agentKey); }}
                      className="text-xs px-2 py-0.5 border rounded"
                      style={{ borderColor: "var(--border)" }}
                    >
                      清除覆盖，恢复默认
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-[80px_1fr] gap-y-2 gap-x-3 items-center text-sm">
                  <label>🤖 MODEL</label>
                  <select
                    data-testid={`override-model-${agentKey}`}
                    value={modelValue}
                    onChange={(e) => handleModelChange(agentKey, e.target.value)}
                    className="border rounded px-2 py-1 bg-transparent"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <option value="">
                      默认: {modelLabel(defaultCfg.model)}
                    </option>
                    {MODEL_CHOICES.filter((m) => modelKey(m) !== modelKey(defaultCfg.model)).map((m) => (
                      <option key={modelKey(m)} value={modelKey(m)}>
                        {modelLabel(m)}
                      </option>
                    ))}
                  </select>

                  <label>🎨 STYLE</label>
                  <select
                    data-testid={`override-style-${agentKey}`}
                    value={styleValue}
                    onChange={(e) => handleStyleChange(agentKey, e.target.value)}
                    className="border rounded px-2 py-1 bg-transparent"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <option value="">
                      默认: {defaultCfg.styleBinding ? styleLabel(defaultCfg.styleBinding) : "(未绑定)"}
                    </option>
                    {roleChoices
                      .filter((p) => {
                        if (!defaultCfg.styleBinding) return true;
                        return !(p.account === defaultCfg.styleBinding.account && p.role === defaultCfg.styleBinding.role);
                      })
                      .map((p) => (
                        <option
                          key={`${p.account}-${p.role}-${p.version}`}
                          value={`${p.account}::${p.role}`}
                        >
                          {styleLabel({ account: p.account, role: p.role as StyleBindingRole }, p.version)}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
            );
          })}
        </div>

        <footer className="flex justify-end gap-2 mt-6">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 text-sm border rounded"
            style={{ borderColor: "var(--border)" }}
          >
            取消
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => { void handleSave(); }}
            className="px-3 py-1 text-sm border rounded"
            style={{ borderColor: "var(--accent)", background: "var(--accent)", color: "var(--accent-on)" }}
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </footer>
      </div>
    </div>
  );
}

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
    setOverride({ agents: (ov as any)?.agents ?? {} });
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
      <div role="dialog" className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,0.55)] backdrop-blur-sm">
        <div className="rounded border border-[var(--hair-strong)] bg-[var(--bg-1)] px-6 py-4 text-sm text-[var(--meta)]">加载中…</div>
      </div>
    );
  }

  return (
    <div
      role="dialog"
      data-testid="project-override-panel"
      data-modal-root=""
      className="fixed inset-0 z-50 flex items-start justify-end bg-[rgba(0,0,0,0.55)] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="h-full w-[480px] max-w-[95vw] overflow-auto shadow-2xl bg-[var(--bg-1)] border-l border-[var(--hair)] text-[var(--body)] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-6 h-14 border-b border-[var(--hair)]">
          <div>
            <h2 className="text-base font-semibold text-[var(--heading)]">本项目配置</h2>
            <div className="text-[10px] text-[var(--faint)]" style={{ fontFamily: "var(--font-mono)" }}>{projectId}</div>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded text-[var(--meta)] hover:text-[var(--heading)] hover:bg-[var(--bg-2)]">✕</button>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="rounded border border-[var(--red)] bg-[rgba(255,107,107,0.05)] px-3 py-2 text-sm text-[var(--red)]">
              {error}
            </div>
          )}

          {WRITER_AGENTS.map((agentKey) => {
            const defaultCfg = defaults[agentKey];
            if (!defaultCfg) return null;
            const ov = override.agents[agentKey] ?? {};
            const role = writerRole(agentKey);
            const modelValue = ov.model ? modelKey(ov.model) : "";
            const styleValue = ov.styleBinding ? styleKey(ov.styleBinding) : "";
            const hasOverride = Boolean(ov.model || ov.styleBinding || ov.tools || ov.promptVersion);
            const roleChoices = role ? (stylePanelsByRole.get(role) ?? []) : [];
            const label =
              agentKey === "writer.opening" ? "开头" :
              agentKey === "writer.practice" ? "Case" :
              agentKey === "writer.closing" ? "结尾" : agentKey;
            const accentColor =
              agentKey === "writer.opening" ? "var(--accent)" :
              agentKey === "writer.practice" ? "var(--amber)" :
              "var(--pink)";

            return (
              <div
                key={agentKey}
                className="rounded bg-[var(--bg-2)] overflow-hidden flex"
              >
                <div className="w-1 shrink-0" style={{ background: accentColor }} />
                <div className="flex-1 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-[var(--heading)]">{label}</div>
                    {hasOverride && (
                      <button
                        type="button"
                        data-testid={`clear-override-${agentKey}`}
                        onClick={() => { void handleClear(agentKey); }}
                        className="text-[10px] text-[var(--accent)] hover:underline"
                      >
                        恢复默认
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-[40px_1fr] gap-x-3 gap-y-1.5 items-center">
                    <span className="text-xs text-[var(--meta)]">模型</span>
                    <select
                      data-testid={`override-model-${agentKey}`}
                      value={modelValue}
                      onChange={(e) => handleModelChange(agentKey, e.target.value)}
                      className="appearance-none w-full bg-[var(--bg-1)] border border-[var(--hair)] rounded h-9 pl-3 pr-8 text-sm text-[var(--body)] outline-none focus:border-[var(--accent-soft)] bg-no-repeat"
                      style={{
                        fontFamily: "var(--font-sans)",
                        backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' stroke='%237e8e7f' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>\")",
                        backgroundPosition: "right 10px center",
                      }}
                    >
                      <option value="">默认 · {modelLabel(defaultCfg.model)}</option>
                      {MODEL_CHOICES.filter((m) => modelKey(m) !== modelKey(defaultCfg.model)).map((m) => (
                        <option key={modelKey(m)} value={modelKey(m)}>
                          {modelLabel(m)}
                        </option>
                      ))}
                    </select>

                    <span className="text-xs text-[var(--meta)]">风格</span>
                    <select
                      data-testid={`override-style-${agentKey}`}
                      value={styleValue}
                      onChange={(e) => handleStyleChange(agentKey, e.target.value)}
                      className="appearance-none w-full bg-[var(--bg-1)] border border-[var(--hair)] rounded h-9 pl-3 pr-8 text-sm text-[var(--body)] outline-none focus:border-[var(--accent-soft)] bg-no-repeat"
                      style={{
                        fontFamily: "var(--font-sans)",
                        backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' stroke='%237e8e7f' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>\")",
                        backgroundPosition: "right 10px center",
                      }}
                    >
                      <option value="">
                        默认 · {defaultCfg.styleBinding ? styleLabel(defaultCfg.styleBinding) : "(未绑定)"}
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
              </div>
            );
          })}
        </div>

        <footer className="flex items-center justify-end gap-2 px-6 py-3 border-t border-[var(--hair)]">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-[var(--meta)] hover:text-[var(--heading)]"
          >
            取消
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => { void handleSave(); }}
            className="px-4 py-1.5 text-xs rounded border border-[var(--accent-soft)] bg-[var(--accent)] text-[var(--accent-on)] font-semibold disabled:opacity-50"
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </footer>
      </div>
    </div>
  );
}

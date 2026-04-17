import { useEffect, useState } from "react";
import {
  getDefaultModel,
  setDefaultModel,
  getAgentConfigs,
  setAgentConfig,
  listConfigStylePanels,
  type DefaultModelConfig,
  type DefaultModelEntry,
  type AgentConfigEntry,
  type StylePanel,
} from "../../api/writer-client.js";

const MODEL_CHOICES: Array<{ label: string; value: DefaultModelEntry }> = [
  { label: "claude · claude-opus-4-6", value: { cli: "claude", model: "claude-opus-4-6" } },
  { label: "claude · claude-sonnet-4-5", value: { cli: "claude", model: "claude-sonnet-4-5" } },
  { label: "codex · gpt-5", value: { cli: "codex", model: "gpt-5" } },
];

type WriterAgentKey = "writer.opening" | "writer.practice" | "writer.closing";
type WriterRole = "opening" | "practice" | "closing";

const WRITER_ROLES: Array<{ key: WriterAgentKey; label: string; role: WriterRole }> = [
  { key: "writer.opening", label: "开头 (opening)", role: "opening" },
  { key: "writer.practice", label: "实测 (practice)", role: "practice" },
  { key: "writer.closing", label: "结尾 (closing)", role: "closing" },
];

const TOOL_KEYS = ["search_wiki", "search_raw"] as const;
type ToolKey = (typeof TOOL_KEYS)[number];

function entryToLabel(e?: DefaultModelEntry): string {
  if (!e) return "";
  return `${e.cli} · ${e.model ?? ""}`.trim();
}

export function BaseTabPanel() {
  const [dm, setDm] = useState<DefaultModelConfig | null>(null);
  const [agents, setAgents] = useState<Record<string, AgentConfigEntry>>({});
  const [panels, setPanels] = useState<StylePanel[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getDefaultModel().then(setDm).catch(() => setDm(null));
    getAgentConfigs().then((r) => setAgents(r.agents)).catch(() => setAgents({}));
    listConfigStylePanels()
      .then((r) => setPanels(r.panels))
      .catch(() => setPanels([]));
  }, []);

  async function updateTier(tier: "writer" | "other", label: string) {
    const choice = MODEL_CHOICES.find((c) => c.label === label);
    if (!choice || !dm) return;
    setSaving(true);
    try {
      const patch = { [tier]: choice.value } as Partial<DefaultModelConfig>;
      await setDefaultModel(patch);
      setDm({ ...dm, ...patch });
    } finally {
      setSaving(false);
    }
  }

  async function updateBinding(
    agentKey: WriterAgentKey,
    role: WriterRole,
    account: string,
  ) {
    const current = agents[agentKey] ?? { agentKey };
    const next: AgentConfigEntry = account
      ? { ...current, agentKey, styleBinding: { account, role } }
      : { ...current, agentKey };
    if (!account) delete next.styleBinding;
    setSaving(true);
    try {
      await setAgentConfig(agentKey, next);
      setAgents({ ...agents, [agentKey]: next });
    } finally {
      setSaving(false);
    }
  }

  async function updateTool(
    agentKey: WriterAgentKey,
    tool: ToolKey,
    enabled: boolean,
  ) {
    const current = agents[agentKey] ?? { agentKey };
    const next: AgentConfigEntry = {
      ...current,
      agentKey,
      tools: { ...(current.tools ?? {}), [tool]: enabled },
    };
    setSaving(true);
    try {
      await setAgentConfig(agentKey, next);
      setAgents({ ...agents, [agentKey]: next });
    } finally {
      setSaving(false);
    }
  }

  if (!dm) return <div className="text-sm text-[var(--meta)]">加载中…</div>;

  const accountsByRole = (role: WriterRole): string[] => {
    const accounts = new Set<string>();
    for (const p of panels) {
      if (p.role === role && p.status === "active") accounts.add(p.account);
    }
    return Array.from(accounts).sort();
  };

  return (
    <div className="space-y-6">
      <section>
        <div className="text-xs uppercase tracking-wide text-[var(--meta)] mb-2">模型</div>
        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <div className="text-sm font-medium mb-1">Writer 模型</div>
            <select
              data-testid="default-model-writer"
              className="w-full px-3 py-2 bg-[var(--bg-2)] border border-[var(--hair)] rounded text-sm"
              value={entryToLabel(dm.writer)}
              disabled={saving}
              onChange={(e) => void updateTier("writer", e.target.value)}
            >
              {MODEL_CHOICES.map((c) => (
                <option key={c.label} value={c.label}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <div className="text-sm font-medium mb-1">其他 agent 模型</div>
            <select
              data-testid="default-model-other"
              className="w-full px-3 py-2 bg-[var(--bg-2)] border border-[var(--hair)] rounded text-sm"
              value={entryToLabel(dm.other)}
              disabled={saving}
              onChange={(e) => void updateTier("other", e.target.value)}
            >
              {MODEL_CHOICES.map((c) => (
                <option key={c.label} value={c.label}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section>
        <div className="text-xs uppercase tracking-wide text-[var(--meta)] mb-2">Writer 风格绑定</div>
        <div className="space-y-2">
          {WRITER_ROLES.map(({ key, label, role }) => {
            const binding = agents[key]?.styleBinding;
            const options = accountsByRole(role);
            return (
              <div key={key} className="flex items-center gap-3 px-3 py-2 rounded bg-[var(--bg-2)]">
                <div className="text-sm w-32">{label}</div>
                <select
                  data-testid={`style-binding-${key}`}
                  className="flex-1 px-2 py-1.5 bg-[var(--bg-1)] border border-[var(--hair)] rounded text-sm"
                  value={binding?.account ?? ""}
                  disabled={saving}
                  onChange={(e) => void updateBinding(key, role, e.target.value)}
                >
                  <option value="">（未绑定）</option>
                  {options.map((acc) => (
                    <option key={acc} value={acc}>
                      {acc}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <div className="text-xs uppercase tracking-wide text-[var(--meta)] mb-2">Writer 工具</div>
        <div className="rounded bg-[var(--bg-2)] p-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-[var(--meta)]">
                <th className="text-left font-normal pb-2">Agent</th>
                {TOOL_KEYS.map((t) => (
                  <th key={t} className="text-center font-normal pb-2">
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {WRITER_ROLES.map(({ key, label }) => {
                const tools = agents[key]?.tools ?? {};
                return (
                  <tr key={key} className="border-t border-[var(--hair)]">
                    <td className="py-2">{label}</td>
                    {TOOL_KEYS.map((t) => (
                      <td key={t} className="text-center">
                        <input
                          type="checkbox"
                          aria-label={`${key}:${t}`}
                          checked={tools[t] !== false}
                          disabled={saving}
                          onChange={(e) => void updateTool(key, t, e.target.checked)}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

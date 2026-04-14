import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentConfigEntry,
  StylePanel,
} from "../../api/writer-client.js";

export interface ModelChoice {
  cli: "claude" | "codex";
  model?: string;
  label: string;
}

export interface AgentCardProps {
  agentKey: string;
  agentConfig: AgentConfigEntry;
  stylePanelChoices: StylePanel[];
  modelChoices: ModelChoice[];
  onChange: (next: AgentConfigEntry) => void;
  debounceMs?: number;
  unconfigured?: boolean;
}

const WRITER_TOOLS = ["search_wiki", "search_raw"] as const;

function modelKey(c: { cli: string; model?: string }): string {
  return `${c.cli}::${c.model ?? ""}`;
}

function styleKey(account: string, role: string): string {
  return `${account}::${role}`;
}

export function AgentCard({
  agentKey,
  agentConfig,
  stylePanelChoices,
  modelChoices,
  onChange,
  debounceMs = 400,
  unconfigured = false,
}: AgentCardProps) {
  const [local, setLocal] = useState<AgentConfigEntry>(agentConfig);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);

  // sync external updates (when parent replaces config post-save) while not dirty
  useEffect(() => {
    if (!dirtyRef.current) setLocal(agentConfig);
  }, [agentConfig]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const isWriter = agentKey.startsWith("writer.");
  const bound = Boolean(local.styleBinding);
  const statusLabel = bound ? "● ACTIVE" : "◉ style_not_bound";
  const statusColor = bound ? "var(--accent)" : "var(--amber)";

  const grouped = useMemo(() => {
    const byAcct = new Map<string, StylePanel[]>();
    for (const p of stylePanelChoices) {
      if (p.status !== "active" || p.is_legacy) continue;
      const arr = byAcct.get(p.account) ?? [];
      arr.push(p);
      byAcct.set(p.account, arr);
    }
    return Array.from(byAcct.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [stylePanelChoices]);

  function scheduleChange(next: AgentConfigEntry) {
    dirtyRef.current = true;
    setLocal(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      dirtyRef.current = false;
      onChange(next);
    }, debounceMs);
  }

  function handleModel(e: React.ChangeEvent<HTMLSelectElement>) {
    const [cli, model] = e.target.value.split("::") as ["claude" | "codex", string];
    scheduleChange({ ...local, model: { cli, model: model || undefined } });
  }

  function handleStyle(e: React.ChangeEvent<HTMLSelectElement>) {
    const v = e.target.value;
    if (!v) {
      const { styleBinding: _ignore, ...rest } = local;
      void _ignore;
      scheduleChange({ ...rest });
      return;
    }
    const [account, role] = v.split("::") as [string, "opening" | "practice" | "closing"];
    scheduleChange({ ...local, styleBinding: { account, role } });
  }

  function handleTool(tool: string, checked: boolean) {
    const nextTools = { ...(local.tools ?? {}), [tool]: checked };
    scheduleChange({ ...local, tools: nextTools });
  }

  function handleEditPrompt() {
    // MVP: noop + toast placeholder
    // eslint-disable-next-line no-alert
    window.alert?.("prompt editor coming in future SP");
  }

  return (
    <div
      data-testid={`agent-card-${agentKey}`}
      className="border border-l-2 border-l-accent border-hair rounded-[6px] p-4 mb-3 bg-bg-2"
    >
      <header className="flex items-center justify-between mb-3">
        <span className="font-mono-term text-sm flex items-center gap-2 text-heading">
          <span className="font-pixel text-[11px] tracking-[0.08em] text-accent">AGENT:</span>
          {agentKey}
          {unconfigured && (
            <span
              data-testid="agent-unconfigured-badge"
              className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--amber-bg)] text-amber border border-[var(--amber-hair)]"
            >
              ⚠️ 尚未配置（保存即创建）
            </span>
          )}
        </span>
        <span className="text-xs" style={{ color: statusColor }}>
          {statusLabel}
        </span>
      </header>

      <div className="grid grid-cols-[80px_1fr] gap-y-2 gap-x-3 items-center text-sm">
        <label>🤖 MODEL</label>
        <select
          data-testid="agent-model-select"
          value={modelKey(local.model)}
          onChange={handleModel}
          className="border rounded px-2 py-1 bg-transparent"
          style={{ borderColor: "var(--border)" }}
        >
          {modelChoices.map((m) => (
            <option key={modelKey(m)} value={modelKey(m)}>
              {m.label}
            </option>
          ))}
        </select>

        {isWriter && (
          <>
            <label>🎨 STYLE</label>
            <select
              data-testid="agent-style-select"
              value={local.styleBinding ? styleKey(local.styleBinding.account, local.styleBinding.role) : ""}
              onChange={handleStyle}
              className="border rounded px-2 py-1 bg-transparent"
              style={{ borderColor: "var(--border)" }}
            >
              <option value="">(none)</option>
              {grouped.map(([account, panels]) => (
                <optgroup key={account} label={account}>
                  {panels.map((p) => (
                    <option
                      key={`${p.account}-${p.role}-${p.version}`}
                      value={styleKey(p.account, p.role)}
                    >
                      {account} / {p.role} v{p.version}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>

            <label>🔧 TOOLS</label>
            <div className="flex gap-4">
              {WRITER_TOOLS.map((t) => (
                <label key={t} className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    aria-label={t}
                    checked={Boolean(local.tools?.[t])}
                    onChange={(e) => handleTool(t, e.target.checked)}
                  />
                  <span>{t}</span>
                </label>
              ))}
            </div>
          </>
        )}

        <label>📝 PROMPT</label>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs opacity-80">{local.promptVersion ?? "(unversioned)"}</span>
          <button
            type="button"
            onClick={handleEditPrompt}
            className="px-2 py-0.5 text-xs border rounded"
            style={{ borderColor: "var(--border)" }}
          >
            EDIT
          </button>
        </div>
      </div>
    </div>
  );
}

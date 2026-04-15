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
  const statusLabel = bound ? "风格已绑定" : "未绑定风格";
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
      className="rounded bg-[var(--bg-2)] p-4"
    >
      <header className="flex items-center justify-between mb-3 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold text-[var(--heading)] truncate" style={{ fontFamily: "var(--font-mono)" }}>
            {agentKey}
          </span>
          {unconfigured && (
            <span
              data-testid="agent-unconfigured-badge"
              className="text-[10px] px-1.5 py-0.5 rounded-sm bg-[var(--amber-bg)] text-[var(--amber)] whitespace-nowrap"
            >
              尚未配置
            </span>
          )}
        </div>
        <span className="inline-flex items-center gap-1.5 text-[11px] shrink-0" style={{ color: statusColor }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: statusColor }} />
          {statusLabel}
        </span>
      </header>

      <div className="grid grid-cols-[70px_1fr] gap-y-2 gap-x-3 items-center text-sm">
        <label className="text-xs text-[var(--meta)]">模型</label>
        <select
          data-testid="agent-model-select"
          value={modelKey(local.model)}
          onChange={handleModel}
          className="bg-[var(--bg-1)] border border-[var(--hair)] rounded px-2 py-1 text-xs text-[var(--body)] outline-none focus:border-[var(--accent-soft)]"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {modelChoices.map((m) => (
            <option key={modelKey(m)} value={modelKey(m)}>
              {m.label}
            </option>
          ))}
        </select>

        {isWriter && (
          <>
            <label className="text-xs text-[var(--meta)]">风格</label>
            <select
              data-testid="agent-style-select"
              value={local.styleBinding ? styleKey(local.styleBinding.account, local.styleBinding.role) : ""}
              onChange={handleStyle}
              className="bg-[var(--bg-1)] border border-[var(--hair)] rounded px-2 py-1 text-xs text-[var(--body)] outline-none focus:border-[var(--accent-soft)]"
            >
              <option value="">未绑定</option>
              {grouped.map(([account, panels]) => (
                <optgroup key={account} label={account}>
                  {panels.map((p) => (
                    <option key={`${p.account}-${p.role}-${p.version}`} value={styleKey(p.account, p.role)}>
                      {account} / {p.role} v{p.version}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>

            <label className="text-xs text-[var(--meta)]">工具</label>
            <div className="flex gap-4">
              {WRITER_TOOLS.map((t) => (
                <label key={t} className="flex items-center gap-1.5 cursor-pointer text-xs text-[var(--body)]">
                  <input
                    type="checkbox"
                    aria-label={t}
                    checked={Boolean(local.tools?.[t])}
                    onChange={(e) => handleTool(t, e.target.checked)}
                    className="accent-[var(--accent)]"
                  />
                  <span style={{ fontFamily: "var(--font-mono)" }}>{t}</span>
                </label>
              ))}
            </div>
          </>
        )}

        <label className="text-xs text-[var(--meta)]">Prompt</label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--meta)]" style={{ fontFamily: "var(--font-mono)" }}>
            {local.promptVersion ?? "未版本化"}
          </span>
          <button
            type="button"
            onClick={handleEditPrompt}
            className="text-xs text-[var(--accent)] hover:underline"
          >
            编辑
          </button>
        </div>
      </div>
    </div>
  );
}

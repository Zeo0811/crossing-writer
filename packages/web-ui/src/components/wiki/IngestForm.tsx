import { useMemo, useState } from "react";
import type { IngestStartArgs } from "../../api/wiki-client";
import { AccountHeatmap } from "./AccountHeatmap";

interface AccountStats {
  account: string;
  count: number;
  ingested_count: number;
}

export interface IngestFormProps {
  accounts: string[];
  accountStats?: AccountStats[];
  onSubmit: (args: IngestStartArgs) => void;
  disabled?: boolean;
}

export function IngestForm({ accounts, accountStats, onSubmit, disabled }: IngestFormProps) {
  const statsMap = useMemo(() => {
    const m = new Map<string, AccountStats>();
    for (const s of accountStats ?? []) m.set(s.account, s);
    return m;
  }, [accountStats]);
  const [selected, setSelected] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [perAccount, setPerAccount] = useState("50");
  const [batchSize, setBatchSize] = useState("5");
  const [mode, setMode] = useState<"full" | "incremental">("full");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [cli, setCli] = useState<"claude" | "codex">("claude");
  const [model, setModel] = useState("opus");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [expandedAccount, setExpandedAccount] = useState<string | null>(null);

  const visible = useMemo(() => {
    return accounts.filter((a) => !q || a.toLowerCase().includes(q.toLowerCase()));
  }, [accounts, q]);

  function toggle(a: string) {
    setSelected((s) => (s.includes(a) ? s.filter((x) => x !== a) : [...s, a]));
  }

  function submit() {
    onSubmit({
      accounts: selected,
      per_account_limit: Number(perAccount) || 50,
      batch_size: Number(batchSize) || 5,
      mode,
      since: since || undefined,
      until: until || undefined,
      cli_model: { cli, model },
    });
  }

  const estimate = selected.length * (Number(perAccount) || 50);

  return (
    <div className="space-y-5">
      <section>
        <div className="flex items-center gap-3 mb-3">
          <div className="text-xs text-[var(--meta)] font-semibold">
            选择要入库的账号
            <span className="ml-2 text-[var(--heading)]">{selected.length}</span>
            <span className="text-[var(--faint)]">/{accounts.length}</span>
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelected(visible)}
              disabled={disabled}
              className="text-xs text-[var(--accent)] hover:underline disabled:opacity-40"
            >
              全选当前
            </button>
            <span className="text-[var(--faint)] text-xs">·</span>
            <button
              onClick={() => setSelected([])}
              disabled={disabled}
              className="text-xs text-[var(--meta)] hover:text-[var(--heading)] disabled:opacity-40"
            >
              清空
            </button>
          </div>
        </div>

        <div className="relative mb-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="过滤账号…"
            disabled={disabled}
            className="w-full bg-[var(--bg-2)] border border-[var(--hair)] rounded px-3 py-2 pl-9 text-sm outline-none focus:border-[var(--accent-soft)] disabled:opacity-60"
          />
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)] pointer-events-none">⌕</span>
        </div>

        <div className="grid grid-cols-3 gap-2 max-h-[280px] overflow-auto pr-1">
          {visible.map((a) => {
            const picked = selected.includes(a);
            const stats = statsMap.get(a);
            const pct = stats && stats.count > 0 ? Math.round((stats.ingested_count / stats.count) * 100) : 0;
            const expanded = expandedAccount === a;
            return (
              <div key={a} className={expanded ? "col-span-3" : ""}>
                <button
                  onClick={() => !disabled && toggle(a)}
                  disabled={disabled}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded border text-sm text-left transition-colors ${
                    picked ? "border-[var(--accent)] bg-[var(--accent-fill)] text-[var(--accent)]" : "border-[var(--hair)] bg-[var(--bg-2)] text-[var(--body)] hover:border-[var(--accent-soft)]"
                  } ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
                >
                  <span className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center text-[9px] shrink-0 ${picked ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-on)]" : "border-[var(--hair-strong)]"}`}>
                    {picked && "✓"}
                  </span>
                  <div className="truncate flex-1 min-w-0">
                    <div className="truncate">{a}</div>
                    {stats && (
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <div className="flex-1 h-1 rounded-full bg-[var(--bg-1)] overflow-hidden">
                          <div className="h-full bg-[var(--accent)]" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-[9px] text-[var(--faint)] shrink-0">{stats.ingested_count}/{stats.count}</span>
                      </div>
                    )}
                  </div>
                  <span
                    onClick={(e) => { e.stopPropagation(); setExpandedAccount(expanded ? null : a); }}
                    className="text-[var(--faint)] hover:text-[var(--heading)] text-xs shrink-0 px-1"
                    title="展开详情"
                  >
                    {expanded ? "▴" : "▾"}
                  </span>
                </button>
                {expanded && (
                  <div className="mt-2 rounded bg-[var(--bg-2)] p-4 border border-[var(--hair)]">
                    <AccountHeatmap account={a} />
                  </div>
                )}
              </div>
            );
          })}
          {visible.length === 0 && (
            <div className="col-span-3 py-6 text-center text-sm text-[var(--faint)]">无匹配账号</div>
          )}
        </div>
      </section>

      <section className="rounded bg-[var(--bg-2)] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-xs text-[var(--meta)] font-semibold">入库配置</div>
          <button
            onClick={() => setShowAdvanced((s) => !s)}
            className="text-xs text-[var(--accent)] hover:underline"
          >
            {showAdvanced ? "收起高级 ▴" : "高级选项 ▾"}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="模式">
            <div className="flex items-center gap-1 p-1 rounded border border-[var(--hair)] bg-[var(--bg-1)]">
              {(["full", "incremental"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`flex-1 px-2 py-1 rounded text-xs ${
                    mode === m ? "bg-[var(--accent-fill)] text-[var(--accent)]" : "text-[var(--meta)] hover:text-[var(--heading)]"
                  }`}
                >
                  {m === "full" ? "全量" : "增量"}
                </button>
              ))}
            </div>
          </Field>
          <Field label="每账号上限">
            <input
              type="number"
              value={perAccount}
              onChange={(e) => setPerAccount(e.target.value)}
              aria-label="per account"
              className="w-full bg-[var(--bg-1)] border border-[var(--hair)] rounded px-3 py-2 text-sm outline-none focus:border-[var(--accent-soft)]"
            />
          </Field>
        </div>

        {showAdvanced && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="批大小">
                <input
                  type="number"
                  value={batchSize}
                  onChange={(e) => setBatchSize(e.target.value)}
                  aria-label="batch size"
                  className="w-full bg-[var(--bg-1)] border border-[var(--hair)] rounded px-3 py-2 text-sm outline-none focus:border-[var(--accent-soft)]"
                />
              </Field>
              <Field label="CLI">
                <select
                  value={cli}
                  onChange={(e) => setCli(e.target.value as "claude" | "codex")}
                  className="w-full bg-[var(--bg-1)] border border-[var(--hair)] rounded px-3 py-2 text-sm outline-none focus:border-[var(--accent-soft)]"
                >
                  <option value="claude">claude</option>
                  <option value="codex">codex</option>
                </select>
              </Field>
              <Field label="模型">
                <input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full bg-[var(--bg-1)] border border-[var(--hair)] rounded px-3 py-2 text-sm outline-none focus:border-[var(--accent-soft)]"
                  style={{ fontFamily: "var(--font-mono)" }}
                />
              </Field>
            </div>
            {mode === "incremental" && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="起始日期">
                  <input
                    value={since}
                    onChange={(e) => setSince(e.target.value)}
                    placeholder="2026-01-01"
                    className="w-full bg-[var(--bg-1)] border border-[var(--hair)] rounded px-3 py-2 text-sm outline-none focus:border-[var(--accent-soft)]"
                  />
                </Field>
                <Field label="结束日期">
                  <input
                    value={until}
                    onChange={(e) => setUntil(e.target.value)}
                    placeholder="2026-04-15"
                    className="w-full bg-[var(--bg-1)] border border-[var(--hair)] rounded px-3 py-2 text-sm outline-none focus:border-[var(--accent-soft)]"
                  />
                </Field>
              </div>
            )}
          </>
        )}
      </section>

      <div className="flex items-center justify-between pt-1">
        <div className="text-xs text-[var(--meta)]">
          {selected.length === 0
            ? "至少选一个账号"
            : <>预计处理 <span className="text-[var(--heading)]">~{estimate}</span> 篇 · {cli} / {model}</>}
        </div>
        <button
          onClick={submit}
          disabled={selected.length === 0 || disabled}
          className="px-5 py-2 rounded border border-[var(--accent-soft)] bg-[var(--accent)] text-[var(--accent-on)] font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:shadow-[0_0_12px_var(--accent-dim)]"
        >
          {disabled ? "进行中…" : "开始入库 →"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-[var(--meta)] block mb-1">{label}</span>
      {children}
    </label>
  );
}

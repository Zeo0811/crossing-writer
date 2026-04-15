import { useState } from "react";
import type { IngestStartArgs } from "../../api/wiki-client";

export interface IngestFormProps {
  accounts: string[];
  onSubmit: (args: IngestStartArgs) => void;
}

export function IngestForm({ accounts, onSubmit }: IngestFormProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [perAccount, setPerAccount] = useState(50);
  const [batchSize, setBatchSize] = useState(5);
  const [mode, setMode] = useState<"full" | "incremental">("full");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [cli, setCli] = useState<"claude" | "codex">("claude");
  const [model, setModel] = useState("opus");

  const toggle = (a: string) => setSelected((s) => (s.includes(a) ? s.filter((x) => x !== a) : [...s, a]));

  const submit = () => {
    onSubmit({
      accounts: selected,
      per_account_limit: perAccount,
      batch_size: batchSize,
      mode,
      since: since || undefined,
      until: until || undefined,
      cli_model: { cli, model },
    });
  };

  return (
    <div className="space-y-4">
      <div className="rounded bg-[var(--bg-2)] p-4 space-y-2">
        <div className="flex items-center justify-between mb-1">
          <div className="text-xs text-[var(--meta)] font-semibold">账号（{selected.length}/{accounts.length}）</div>
          <div className="flex gap-2 text-[10px]">
            <button onClick={() => setSelected(accounts)} className="text-[var(--accent)] hover:underline">全选</button>
            <button onClick={() => setSelected([])} className="text-[var(--meta)] hover:text-[var(--heading)]">清空</button>
          </div>
        </div>
        <div className="max-h-[200px] overflow-auto space-y-0.5 pr-1">
          {accounts.map((a) => (
            <label key={a} className="flex items-center gap-2 py-1 text-sm cursor-pointer hover:bg-[var(--bg-1)] px-2 rounded">
              <input
                type="checkbox"
                checked={selected.includes(a)}
                onChange={() => toggle(a)}
                aria-label={a}
                className="accent-[var(--accent)]"
              />
              <span className="text-[var(--body)]">{a}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="模式">
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as "full" | "incremental")}
            className="w-full bg-[var(--bg-2)] border border-[var(--hair)] rounded px-3 py-2 text-sm outline-none focus:border-[var(--accent-soft)]"
          >
            <option value="full">全量 full</option>
            <option value="incremental">增量 incremental</option>
          </select>
        </Field>
        <Field label="每账号上限">
          <input
            type="number"
            value={perAccount}
            onChange={(e) => setPerAccount(Number(e.target.value))}
            aria-label="per account"
            className="w-full bg-[var(--bg-2)] border border-[var(--hair)] rounded px-3 py-2 text-sm outline-none focus:border-[var(--accent-soft)]"
          />
        </Field>
        <Field label="批大小">
          <input
            type="number"
            value={batchSize}
            onChange={(e) => setBatchSize(Number(e.target.value))}
            aria-label="batch size"
            className="w-full bg-[var(--bg-2)] border border-[var(--hair)] rounded px-3 py-2 text-sm outline-none focus:border-[var(--accent-soft)]"
          />
        </Field>
        <Field label="CLI">
          <select
            value={cli}
            onChange={(e) => setCli(e.target.value as "claude" | "codex")}
            className="w-full bg-[var(--bg-2)] border border-[var(--hair)] rounded px-3 py-2 text-sm outline-none focus:border-[var(--accent-soft)]"
          >
            <option value="claude">claude</option>
            <option value="codex">codex</option>
          </select>
        </Field>
        <Field label="模型">
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full bg-[var(--bg-2)] border border-[var(--hair)] rounded px-3 py-2 text-sm outline-none focus:border-[var(--accent-soft)]"
          />
        </Field>
        {mode === "incremental" && (
          <>
            <Field label="起始日期 (ISO)">
              <input value={since} onChange={(e) => setSince(e.target.value)} placeholder="2026-01-01" className="w-full bg-[var(--bg-2)] border border-[var(--hair)] rounded px-3 py-2 text-sm outline-none focus:border-[var(--accent-soft)]" />
            </Field>
            <Field label="结束日期 (ISO)">
              <input value={until} onChange={(e) => setUntil(e.target.value)} placeholder="2026-04-15" className="w-full bg-[var(--bg-2)] border border-[var(--hair)] rounded px-3 py-2 text-sm outline-none focus:border-[var(--accent-soft)]" />
            </Field>
          </>
        )}
      </div>

      <div className="flex justify-end">
        <button
          onClick={submit}
          disabled={selected.length === 0}
          className="px-5 py-2 rounded border border-[var(--accent-soft)] bg-[var(--accent)] text-[var(--accent-on)] text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:shadow-[0_0_12px_var(--accent-dim)] transition-shadow"
        >
          开始入库 →
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

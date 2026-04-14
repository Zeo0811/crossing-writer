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
    <div className="flex flex-col gap-3 p-4 max-w-xl text-sm">
      <fieldset className="border border-gray-300 rounded p-2">
        <legend className="px-1 text-xs text-gray-600">Accounts</legend>
        {accounts.map((a) => (
          <label key={a} className="block py-0.5">
            <input type="checkbox" checked={selected.includes(a)} onChange={() => toggle(a)} aria-label={a} /> {a}
          </label>
        ))}
      </fieldset>

      <label className="flex items-center gap-2">
        Mode:
        <select value={mode} onChange={(e) => setMode(e.target.value as "full" | "incremental")} className="border rounded px-2 py-1">
          <option value="full">full</option>
          <option value="incremental">incremental</option>
        </select>
      </label>

      <label className="flex items-center gap-2">
        Per account limit:
        <input type="number" value={perAccount} onChange={(e) => setPerAccount(Number(e.target.value))} aria-label="per account" className="border rounded px-2 py-1 w-24" />
      </label>

      <label className="flex items-center gap-2">
        Batch size:
        <input type="number" value={batchSize} onChange={(e) => setBatchSize(Number(e.target.value))} aria-label="batch size" className="border rounded px-2 py-1 w-24" />
      </label>

      {mode === "incremental" && (
        <>
          <label className="flex items-center gap-2">Since (ISO): <input value={since} onChange={(e) => setSince(e.target.value)} className="border rounded px-2 py-1 flex-1" /></label>
          <label className="flex items-center gap-2">Until (ISO): <input value={until} onChange={(e) => setUntil(e.target.value)} className="border rounded px-2 py-1 flex-1" /></label>
        </>
      )}

      <label className="flex items-center gap-2">
        CLI:
        <select value={cli} onChange={(e) => setCli(e.target.value as "claude" | "codex")} className="border rounded px-2 py-1">
          <option value="claude">claude</option>
          <option value="codex">codex</option>
        </select>
      </label>

      <label className="flex items-center gap-2">
        Model:
        <input value={model} onChange={(e) => setModel(e.target.value)} className="border rounded px-2 py-1 flex-1" />
      </label>

      <button onClick={submit} disabled={selected.length === 0} className="px-4 py-2 bg-blue-600 text-white rounded text-sm disabled:opacity-40">
        Start ingest
      </button>
    </div>
  );
}

import { useState } from "react";
import type { DistillBody } from "../../api/style-panels-client.js";

export interface DistillFormProps {
  account: string;
  totalInRange: number;
  onCancel: () => void;
  onSubmit: (body: DistillBody) => void;
}

type StepKey = "structure" | "snippets" | "composer";

export function DistillForm({ account, totalInRange, onCancel, onSubmit }: DistillFormProps) {
  const [sampleSize, setSampleSize] = useState<number>(Math.min(200, totalInRange));
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [clis, setClis] = useState<Record<StepKey, { cli: "claude" | "codex"; model: string }>>({
    structure: { cli: "claude", model: "opus" },
    snippets:  { cli: "claude", model: "opus" },
    composer:  { cli: "claude", model: "opus" },
  });
  const [error, setError] = useState<string | null>(null);

  function submit() {
    if (sampleSize < 20) { setError("sample_size 至少 20"); return; }
    if (sampleSize > totalInRange) { setError(`sample_size 超过总文章数 ${totalInRange}`); return; }
    if (since && until && since > until) { setError("时间范围反了"); return; }
    onSubmit({
      sample_size: sampleSize,
      since: since || undefined,
      until: until || undefined,
      cli_model_per_step: {
        structure: clis.structure,
        snippets: clis.snippets,
        composer: clis.composer,
      },
    });
  }

  return (
    <div className="border rounded p-4 space-y-4 bg-[var(--bg-1)]">
      <div>
        <h2 className="text-lg font-semibold">蒸馏 {account}</h2>
        <div className="text-xs text-[var(--meta)] mt-1">文章来源: refs.sqlite · {totalInRange} 篇</div>
      </div>

      <div className="grid grid-cols-3 gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[var(--meta)]">sample_size</span>
          <input
            aria-label="sample_size" type="number" min={20} max={totalInRange}
            value={sampleSize} onChange={(e) => setSampleSize(Number(e.target.value))}
            className="border rounded px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[var(--meta)]">since</span>
          <input aria-label="since" type="date" value={since} onChange={(e) => setSince(e.target.value)} className="border rounded px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[var(--meta)]">until</span>
          <input aria-label="until" type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="border rounded px-2 py-1" />
        </label>
      </div>

      <fieldset className="border rounded p-3 space-y-2">
        <legend className="text-xs text-[var(--meta)] px-1">agent 配置</legend>
        {(["structure", "snippets", "composer"] as StepKey[]).map((k) => (
          <div key={k} className="flex items-center gap-2 text-sm">
            <span className="w-20 font-mono text-xs">{k}:</span>
            <select
              value={clis[k].cli}
              onChange={(e) => setClis({ ...clis, [k]: { ...clis[k], cli: e.target.value as "claude" | "codex" } })}
              className="border rounded px-2 py-1"
            >
              <option value="claude">claude</option>
              <option value="codex">codex</option>
            </select>
            <input
              value={clis[k].model}
              onChange={(e) => setClis({ ...clis, [k]: { ...clis[k], model: e.target.value } })}
              className="border rounded px-2 py-1 flex-1"
              placeholder="model (e.g. opus)"
            />
          </div>
        ))}
      </fieldset>

      {error && <div className="text-sm text-[var(--red)]">{error}</div>}

      <div className="flex gap-2">
        <button type="button" onClick={submit} className="px-4 py-2 bg-[var(--accent)] text-white rounded text-sm">开始蒸馏</button>
        <button type="button" onClick={onCancel} className="px-4 py-2 border rounded text-sm">取消</button>
      </div>
    </div>
  );
}

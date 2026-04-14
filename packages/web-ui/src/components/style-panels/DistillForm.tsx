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
    <div className="distill-form">
      <h2>蒸馏 {account}</h2>
      <div>文章来源: refs.sqlite · {totalInRange} 篇</div>
      <label>sample_size: <input aria-label="sample_size" type="number" value={sampleSize} onChange={(e) => setSampleSize(Number(e.target.value))} min={20} max={totalInRange} /></label>
      <label>since: <input aria-label="since" type="date" value={since} onChange={(e) => setSince(e.target.value)} /></label>
      <label>until: <input aria-label="until" type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></label>
      <fieldset>
        <legend>agent 配置</legend>
        {(["structure", "snippets", "composer"] as StepKey[]).map((k) => (
          <div key={k}>
            {k}:{" "}
            <select value={clis[k].cli} onChange={(e) => setClis({ ...clis, [k]: { ...clis[k], cli: e.target.value as "claude" | "codex" } })}>
              <option value="claude">claude</option>
              <option value="codex">codex</option>
            </select>
            <input value={clis[k].model} onChange={(e) => setClis({ ...clis, [k]: { ...clis[k], model: e.target.value } })} />
          </div>
        ))}
      </fieldset>
      {error && <div className="error">{error}</div>}
      <button type="button" onClick={submit}>开始蒸馏</button>
      <button type="button" onClick={onCancel}>取消</button>
    </div>
  );
}

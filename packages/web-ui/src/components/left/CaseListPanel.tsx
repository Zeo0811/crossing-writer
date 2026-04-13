import { useState } from "react";
import { useCaseCandidates } from "../../hooks/useCaseCandidates";
import { selectCases } from "../../api/client";
import { CaseCardPreview } from "./CaseCardPreview";

export function CaseListPanel({ projectId }: { projectId: string }) {
  const { cases, loading } = useCaseCandidates(projectId);
  const [picked, setPicked] = useState<Set<number>>(new Set());

  if (loading) return <div>加载中...</div>;
  if (cases.length === 0) return <div>尚无 Case 候选</div>;

  function toggle(idx: number) {
    setPicked((prev) => {
      const n = new Set(prev);
      if (n.has(idx)) n.delete(idx);
      else if (n.size < 4) n.add(idx);
      return n;
    });
  }

  async function approve() {
    await selectCases(projectId, Array.from(picked).sort((a, b) => a - b));
  }

  return (
    <div className="p-4">
      <h3 className="font-semibold">{cases.length} 个候选 Case</h3>
      <ul className="space-y-3 mt-2">
        {cases.map((c) => (
          <li key={c.index} className="border p-2">
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={picked.has(c.index)}
                onChange={() => toggle(c.index)} />
              <div>
                <div><strong>Case {c.index} — {c.name}</strong></div>
                <div className="text-xs">by {c.proposed_by} · 创意 {c.creativity_score}</div>
                <div className="text-sm">{c.why_it_matters}</div>
              </div>
            </label>
            <CaseCardPreview c={c} />
          </li>
        ))}
      </ul>
      <div className="mt-4">
        已选 {picked.size} / 4
        <button className="ml-4 bg-blue-600 text-white px-3 py-1"
          disabled={picked.size < 2} onClick={approve}>
          批准这些 Case
        </button>
      </div>
    </div>
  );
}

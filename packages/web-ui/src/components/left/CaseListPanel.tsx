import { useState } from "react";
import { useCaseCandidates } from "../../hooks/useCaseCandidates";
import { selectCases } from "../../api/client";
import { CaseCardPreview } from "./CaseCardPreview";
import { ActionButton } from "../ui/ActionButton";

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
        <ActionButton
          onClick={approve}
          disabled={picked.size < 2}
          successMsg="Case 已选定"
          errorMsg={(e) => `选定失败: ${String(e)}`}
        >
          批准这些 Case
        </ActionButton>
      </div>
    </div>
  );
}

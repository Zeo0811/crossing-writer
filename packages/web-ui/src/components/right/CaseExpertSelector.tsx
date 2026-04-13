import { useEffect, useState } from "react";
import { listCaseExperts, startCasePlan, type CaseExpertInfo } from "../../api/client";

export function CaseExpertSelector({ projectId }: { projectId: string }) {
  const [experts, setExperts] = useState<CaseExpertInfo[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    listCaseExperts(projectId).then((list) => {
      setExperts(list);
      setSelected(new Set(list.filter((e) => e.preselected).map((e) => e.name)));
    });
  }, [projectId]);

  function toggle(name: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(name)) n.delete(name); else n.add(name);
      return n;
    });
  }

  async function onStart() {
    await startCasePlan(projectId, Array.from(selected));
  }

  return (
    <div className="p-4">
      <h3 className="font-semibold">选择 Case 专家</h3>
      <ul className="space-y-1 mt-2">
        {experts.map((e) => (
          <li key={e.name}>
            <label>
              <input type="checkbox" checked={selected.has(e.name)}
                onChange={() => toggle(e.name)} />
              <span> {e.name} · 创意 {e.creativity_score ?? "-"} · {e.specialty}</span>
            </label>
          </li>
        ))}
      </ul>
      <button onClick={onStart} disabled={selected.size === 0}
        className="mt-4 bg-blue-600 text-white px-3 py-1">
        开跑 Case 规划
      </button>
    </div>
  );
}

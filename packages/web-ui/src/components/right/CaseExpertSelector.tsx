import { useEffect, useState } from "react";
import { listCaseExperts, startCasePlan, type CaseExpertInfo } from "../../api/client";
import { ActionButton } from "../ui/ActionButton";

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
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {experts.map((e) => {
          const picked = selected.has(e.name);
          return (
            <button
              key={e.name}
              type="button"
              onClick={() => toggle(e.name)}
              className={`text-left rounded p-4 border transition-colors ${
                picked ? "border-[var(--accent)] bg-[var(--accent-fill)]" : "border-[var(--hair)] bg-[var(--bg-1)] hover:border-[var(--accent-soft)]"
              }`}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="font-semibold text-[var(--heading)]">{e.name}</div>
                <span
                  className={`w-4 h-4 rounded-sm border flex items-center justify-center text-[10px] ${
                    picked ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-on)]" : "border-[var(--hair-strong)]"
                  }`}
                >
                  {picked && "✓"}
                </span>
              </div>
              {e.specialty && (
                <p className="text-xs text-[var(--meta)] leading-relaxed mb-2">{e.specialty}</p>
              )}
              {e.creativity_score != null && (
                <div className="text-[10px] text-[var(--faint)]">创意 {e.creativity_score}</div>
              )}
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--meta)]">已选 {selected.size} 位 · 至少 1 位</span>
        <ActionButton
          onClick={onStart}
          disabled={selected.size === 0}
          successMsg="Case 规划已启动"
          errorMsg={(e) => `启动失败：${String(e)}`}
        >
          启动规划 →
        </ActionButton>
      </div>
    </div>
  );
}

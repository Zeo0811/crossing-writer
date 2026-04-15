import { useState } from "react";
import { useMock } from "../../MockProvider";
import { CASE_EXPERTS } from "../../fixtures/experts";
import { CASE_CANDIDATES } from "../../fixtures/candidates";

export function CasePhase() {
  const m = useMock();
  switch (m.heroStatus) {
    case "awaiting_case_expert_selection":
      return <CaseExpertPicker />;
    case "case_planning_running":
    case "case_synthesizing":
      return <CaseRunning />;
    case "case_planning_failed":
      return <CaseFailed />;
    case "awaiting_case_selection":
      return <CaseSelector />;
    case "case_plan_approved":
      return <CaseApproved />;
    default:
      return null;
  }
}

function CaseExpertPicker() {
  const m = useMock();
  const [picked, setPicked] = useState<string | null>(null);
  function start() {
    if (!picked) { m.pushToast({ type: "error", message: "至少挑一位专家" }); return; }
    m.setHeroStatus("case_planning_running");
    m.pushToast({ type: "info", message: "正在生成 Case 建议…" });
    setTimeout(() => m.setHeroStatus("case_synthesizing"), 1500);
    setTimeout(() => { m.setHeroStatus("awaiting_case_selection"); m.pushToast({ type: "success", message: "Case 候选已就绪" }); }, 3000);
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {CASE_EXPERTS.map((e) => (
          <button
            key={e.id}
            onClick={() => setPicked(e.id)}
            className={`text-left rounded p-4 border ${picked === e.id ? "border-[var(--accent)] bg-[var(--accent-fill)]" : "border-[var(--hair)] bg-[var(--bg-2)] hover:border-[var(--accent-soft)]"}`}
          >
            <div className="font-semibold text-[var(--heading)] mb-1">{e.name}</div>
            <span className="inline-block text-[10px] px-1.5 py-0.5 rounded-sm bg-[var(--bg-1)] text-[var(--meta)] mb-2">{e.tag}</span>
            <p className="text-xs text-[var(--meta)] leading-relaxed">{e.blurb}</p>
            <div className="mt-3 text-[10px] text-[var(--faint)]" style={{ fontFamily: "var(--font-mono)" }}>{e.cli} · {e.model}</div>
          </button>
        ))}
      </div>
      <div className="flex justify-end">
        <button onClick={start} className="px-5 py-2 rounded border border-[var(--accent-soft)] bg-[var(--accent)] text-[var(--accent-on)] font-semibold">生成 Case 建议 →</button>
      </div>
    </div>
  );
}

function CaseRunning() {
  const m = useMock();
  return (
    <div className="rounded bg-[var(--bg-2)] p-6 space-y-4">
      <div className="text-sm text-[var(--heading)] font-semibold">{m.heroStatus === "case_synthesizing" ? "Case 综合中…" : "Case 规划中…"}</div>
      <div className="space-y-2">
        {[80, 60, 90, 70, 50].map((w, i) => (
          <span key={i} className="block h-3 rounded bg-[var(--bg-1)] overflow-hidden">
            <span className="block h-full bg-[var(--accent-fill)] animate-pulse" style={{ width: `${w}%`, animationDelay: `${i * 0.1}s` }} />
          </span>
        ))}
      </div>
    </div>
  );
}

function CaseFailed() {
  const m = useMock();
  return (
    <div className="rounded border border-[var(--red)] bg-[rgba(255,107,107,0.05)] p-6 space-y-4">
      <div className="text-[var(--red)] font-semibold">Case 规划失败</div>
      <p className="text-sm">claude-sonnet-4-6 返回为空。</p>
      <button onClick={() => m.setHeroStatus("case_planning_running")} className="px-4 py-2 rounded bg-[var(--accent)] text-[var(--accent-on)] text-sm font-semibold">重试</button>
    </div>
  );
}

function CaseSelector() {
  const m = useMock();
  const [items, setItems] = useState(CASE_CANDIDATES);
  function toggle(id: string) {
    setItems((prev) => prev.map((c) => (c.id === id ? { ...c, selected: !c.selected } : c)));
  }
  const selectedCount = items.filter((c) => c.selected).length;
  function approve() {
    if (selectedCount === 0) { m.pushToast({ type: "error", message: "至少勾选 1 个 Case" }); return; }
    m.setHeroStatus("case_plan_approved");
    m.pushToast({ type: "success", message: "Case 已批准" });
  }
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {items.map((c) => (
          <button
            key={c.id}
            onClick={() => toggle(c.id)}
            className={`w-full text-left rounded p-3 border flex items-start gap-3 ${
              c.selected ? "border-[var(--accent-soft)] bg-[var(--accent-fill)]" : "border-[var(--hair)] bg-[var(--bg-2)]"
            }`}
          >
            <span className={`mt-0.5 w-4 h-4 rounded-sm border flex items-center justify-center text-[10px] ${c.selected ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-on)]" : "border-[var(--hair-strong)]"}`}>
              {c.selected && "✓"}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <div className="font-semibold text-[var(--heading)]">{c.title}</div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-sm ${c.difficulty === "硬核" ? "bg-[var(--amber-bg)] text-[var(--amber)]" : c.difficulty === "中等" ? "bg-[var(--bg-1)] text-[var(--meta)]" : "bg-[var(--accent-fill)] text-[var(--accent)]"}`}>{c.difficulty}</span>
                <span className="text-[10px] text-[var(--faint)]">{c.expectedDuration}</span>
              </div>
              <div className="text-xs text-[var(--meta)]">{c.description}</div>
            </div>
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--meta)]">已选 {selectedCount} / {items.length}</span>
        <button onClick={approve} className="px-5 py-2 rounded border border-[var(--accent-soft)] bg-[var(--accent)] text-[var(--accent-on)] font-semibold">批准 Case 计划 →</button>
      </div>
    </div>
  );
}

function CaseApproved() {
  const m = useMock();
  return (
    <div className="rounded border border-[var(--accent-soft)] bg-[var(--accent-fill)] p-4 flex items-center gap-3">
      <span className="text-2xl text-[var(--accent)]">✓</span>
      <div className="flex-1">
        <div className="text-sm text-[var(--accent)] font-semibold">Case 计划已批准</div>
        <div className="text-xs text-[var(--meta)]">下一步：去跑真实测，把截图 / 录屏 / 笔记传到每个 Case 下。</div>
      </div>
      <button onClick={() => m.setHeroStatus("evidence_collecting")} className="px-4 py-2 rounded bg-[var(--accent)] text-[var(--accent-on)] text-sm font-semibold">进入实测 →</button>
    </div>
  );
}

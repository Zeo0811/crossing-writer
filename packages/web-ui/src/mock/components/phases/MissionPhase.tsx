import { useState } from "react";
import { useMock } from "../../MockProvider";
import { MISSION_EXPERTS } from "../../fixtures/experts";
import { MISSION_CANDIDATES, type MissionCandidate } from "../../fixtures/candidates";

export function MissionPhase() {
  const m = useMock();
  switch (m.heroStatus) {
    case "awaiting_expert_selection":
      return <ExpertPicker />;
    case "round1_running":
    case "synthesizing":
    case "round2_running":
      return <MissionRunning />;
    case "round1_failed":
    case "round2_failed":
      return <MissionFailed />;
    case "awaiting_mission_pick":
      return <MissionCandidates />;
    case "mission_approved":
      return <MissionApproved />;
    default:
      return null;
  }
}

function ExpertPicker() {
  const m = useMock();
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  function toggle(id: string) {
    setPickedIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }
  function start() {
    if (pickedIds.length === 0) {
      m.pushToast({ type: "error", message: "至少挑一位专家" });
      return;
    }
    m.setHeroStatus("round1_running");
    m.pushToast({ type: "info", message: "正在启动选题专家团…" });
    setTimeout(() => m.setHeroStatus("synthesizing"), 1800);
    setTimeout(() => m.setHeroStatus("round2_running"), 3300);
    setTimeout(() => {
      m.setHeroStatus("awaiting_mission_pick");
      m.pushToast({ type: "success", message: "候选选题已就绪" });
    }, 4800);
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {MISSION_EXPERTS.map((e) => {
          const picked = pickedIds.includes(e.id);
          return (
            <button
              key={e.id}
              onClick={() => toggle(e.id)}
              className={`text-left rounded p-4 border transition-colors ${
                picked
                  ? "border-[var(--accent)] bg-[var(--accent-fill)]"
                  : "border-[var(--hair)] bg-[var(--bg-2)] hover:border-[var(--accent-soft)]"
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
              <span className="inline-block text-[10px] px-1.5 py-0.5 rounded-sm bg-[var(--bg-1)] text-[var(--meta)] mb-2">{e.tag}</span>
              <p className="text-xs text-[var(--meta)] leading-relaxed">{e.blurb}</p>
              <div className="mt-3 text-[10px] text-[var(--faint)] flex items-center gap-1.5" style={{ fontFamily: "var(--font-mono)" }}>
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />
                {e.cli} · {e.model}
              </div>
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--meta)]">已选 {pickedIds.length} 位 · 至少 1 位</span>
        <button
          onClick={start}
          className="px-5 py-2 rounded border border-[var(--accent-soft)] bg-[var(--accent)] text-[var(--accent-on)] font-semibold hover:shadow-[0_0_12px_var(--accent-dim)]"
        >
          启动专家团 →
        </button>
      </div>
    </div>
  );
}

const ROUND_LABELS: Record<string, { phase: string; eta: string }> = {
  round1_running: { phase: "第一轮思考中", eta: "约 1-2 分钟" },
  synthesizing: { phase: "Coordinator 综合中", eta: "约 30 秒" },
  round2_running: { phase: "第二轮收敛中", eta: "约 1 分钟" },
};

function MissionRunning() {
  const m = useMock();
  const meta = ROUND_LABELS[m.heroStatus] ?? { phase: "运行中", eta: "" };
  return (
    <div className="rounded bg-[var(--bg-2)] p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-[var(--heading)] font-semibold">{meta.phase}</div>
          <div className="text-xs text-[var(--meta)] mt-0.5">{meta.eta}</div>
        </div>
        <button onClick={() => m.setHeroStatus("awaiting_expert_selection")} className="text-xs text-[var(--meta)] hover:text-[var(--red)]">
          取消
        </button>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {MISSION_EXPERTS.map((e) => (
          <div key={e.id} className="rounded bg-[var(--bg-1)] p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm text-[var(--heading)] font-medium">{e.name}</div>
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
            </div>
            <div className="space-y-1">
              <span className="block h-2 rounded bg-[var(--bg-2)] overflow-hidden"><span className="block h-full w-3/4 bg-[var(--accent-soft)] animate-pulse" /></span>
              <span className="block h-2 rounded bg-[var(--bg-2)] overflow-hidden"><span className="block h-full w-1/2 bg-[var(--accent-soft)] animate-pulse" style={{ animationDelay: "0.2s" }} /></span>
            </div>
            <div className="text-[10px] text-[var(--faint)]" style={{ fontFamily: "var(--font-mono)" }}>{e.cli}</div>
          </div>
        ))}
      </div>
      <pre className="rounded bg-[var(--log-bg)] border border-[var(--hair)] p-3 text-[11px] text-[var(--body)] overflow-x-auto max-h-[160px]" style={{ fontFamily: "var(--font-mono)" }}>
{`[14:22:04] coordinator › 派发 brief 给 3 位专家
[14:22:08] lin     › 已读取 brief.md，开始构思角度
[14:22:08] wei     › 已读取 brief.md，列举差异点
[14:22:09] yu      › 拉取行业近 7 天热度
[14:22:42] lin     › 草稿一：「权责变化」叙事…`}
      </pre>
    </div>
  );
}

function MissionFailed() {
  const m = useMock();
  return (
    <div className="rounded border border-[var(--red)] bg-[rgba(255,107,107,0.05)] p-6 space-y-4">
      <div className="flex items-start gap-3">
        <span className="text-2xl text-[var(--red)]">⚠</span>
        <div className="flex-1">
          <div className="text-[var(--red)] font-semibold mb-1">专家团跑挂了</div>
          <p className="text-sm text-[var(--body)]">claude (sonnet-4-6) 在第一轮 3 分钟未返回，已标记 timeout。</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={() => m.setHeroStatus("round1_running")} className="px-4 py-2 rounded bg-[var(--accent)] text-[var(--accent-on)] text-sm font-semibold">重试</button>
        <button onClick={() => m.setHeroStatus("awaiting_expert_selection")} className="px-4 py-2 rounded border border-[var(--hair-strong)] text-[var(--meta)] hover:text-[var(--heading)] text-sm">换专家</button>
      </div>
    </div>
  );
}

function MissionCandidates() {
  const m = useMock();
  const [picked, setPicked] = useState<string | null>(null);
  function approve() {
    if (!picked) return;
    m.setHeroStatus("mission_approved");
    m.pushToast({ type: "success", message: "选题已选定" });
  }
  function regen() {
    m.setHeroStatus("round1_running");
    m.pushToast({ type: "info", message: "正在重新生成…" });
    setTimeout(() => m.setHeroStatus("awaiting_mission_pick"), 2200);
  }
  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {MISSION_CANDIDATES.map((c) => (
          <CandidateCard key={c.id} c={c} picked={picked === c.id} onPick={() => setPicked(c.id)} />
        ))}
      </div>
      <div className="flex items-center justify-between">
        <button onClick={regen} className="text-xs text-[var(--meta)] hover:text-[var(--accent)]">↻ 重新生成 3 个候选</button>
        <button
          onClick={approve}
          disabled={!picked}
          className="px-5 py-2 rounded border border-[var(--accent-soft)] bg-[var(--accent)] text-[var(--accent-on)] font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
        >
          选定该选题 →
        </button>
      </div>
    </div>
  );
}

function CandidateCard({ c, picked, onPick }: { c: MissionCandidate; picked: boolean; onPick: () => void }) {
  return (
    <button
      onClick={onPick}
      className={`w-full text-left rounded p-4 border transition-colors ${
        picked ? "border-[var(--accent)] bg-[var(--accent-fill)]" : "border-[var(--hair)] bg-[var(--bg-2)] hover:border-[var(--accent-soft)]"
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center ${
            picked ? "border-[var(--accent)] bg-[var(--accent)]" : "border-[var(--hair-strong)]"
          }`}
        >
          {picked && <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-on)]" />}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-[var(--heading)] font-semibold">{c.title}</h3>
            <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-[var(--bg-1)] text-[var(--meta)]">{c.angle}</span>
          </div>
          <p className="text-sm text-[var(--body)] mb-2 italic">「{c.hook}」</p>
          <p className="text-xs text-[var(--meta)]"><span className="text-[var(--faint)]">为什么：</span>{c.why}</p>
        </div>
      </div>
    </button>
  );
}

function MissionApproved() {
  const m = useMock();
  return (
    <div className="rounded border border-[var(--accent-soft)] bg-[var(--accent-fill)] p-4 flex items-center gap-3">
      <span className="text-2xl text-[var(--accent)]">✓</span>
      <div className="flex-1">
        <div className="text-sm text-[var(--accent)] font-semibold">选题已选定</div>
        <div className="text-xs text-[var(--meta)]">下一步：补充产品官方资料，生成产品概览。</div>
      </div>
      <button
        onClick={() => m.setHeroStatus("awaiting_overview_input")}
        className="px-4 py-2 rounded bg-[var(--accent)] text-[var(--accent-on)] text-sm font-semibold"
      >
        进入产品解析 →
      </button>
    </div>
  );
}

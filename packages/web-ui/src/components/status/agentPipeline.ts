import type { StreamEvent } from "../../hooks/useProjectStream";

export type PhaseKey = "brief" | "mission" | "overview" | "case" | "evidence" | "writer";
export type PhaseStatus = "todo" | "running" | "done" | "failed";

export interface Phase {
  key: PhaseKey;
  label: string;
  status: PhaseStatus;
}

export interface CurrentActivity {
  agent: string;
  cli?: string;
  model?: string | null;
  round?: number | null;
  description: string;
  startedAt?: string | number;
  status: "running" | "done" | "failed";
}

export interface PipelineSnapshot {
  phases: Phase[];
  currentActivity: CurrentActivity | null;
}

const PHASE_DEFS: Array<{ key: PhaseKey; label: string }> = [
  { key: "brief", label: "Brief" },
  { key: "mission", label: "Mission" },
  { key: "overview", label: "Overview" },
  { key: "case", label: "Cases" },
  { key: "evidence", label: "Evidence" },
  { key: "writer", label: "Writer" },
];

function emptyPhases(): Record<PhaseKey, PhaseStatus> {
  return {
    brief: "todo",
    mission: "todo",
    overview: "todo",
    case: "todo",
    evidence: "todo",
    writer: "todo",
  };
}

function bumpRunning(map: Record<PhaseKey, PhaseStatus>, key: PhaseKey) {
  if (map[key] !== "done" && map[key] !== "failed") map[key] = "running";
}

function markDone(map: Record<PhaseKey, PhaseStatus>, key: PhaseKey) {
  if (map[key] !== "failed") map[key] = "done";
}

function markFailed(map: Record<PhaseKey, PhaseStatus>, key: PhaseKey) {
  map[key] = "failed";
}

function classifyPhase(ev: StreamEvent): { phase: PhaseKey; transition: "start" | "end" | "fail" | "touch" } | null {
  const t = ev.type;
  const d = (ev.data ?? ev.payload ?? {}) as any;

  // state_changed transitions
  if (t === "state_changed") {
    const to = d.to ?? d.state ?? "";
    if (to === "brief_ready") return { phase: "brief", transition: "end" };
    if (to === "round1_running" || to === "round2_running") return { phase: "mission", transition: "start" };
    if (to === "awaiting_mission_pick" || to === "mission_approved") return { phase: "mission", transition: "end" };
    if (to === "overview_running") return { phase: "overview", transition: "start" };
    if (to === "overview_ready") return { phase: "overview", transition: "end" };
    if (to === "case_running") return { phase: "case", transition: "start" };
    if (to === "cases_selected" || to === "case_ready") return { phase: "case", transition: "end" };
    if (to === "evidence_ready") return { phase: "evidence", transition: "end" };
    if (to === "writing") return { phase: "writer", transition: "start" };
    if (to === "writer_done" || to === "writing_done") return { phase: "writer", transition: "end" };
    return null;
  }

  // brief
  const agent = ev.agent ?? d.agent;
  if (agent === "brief_analyst") {
    if (/started$/.test(t)) return { phase: "brief", transition: "start" };
    if (/completed$|done$|ready$/.test(t)) return { phase: "brief", transition: "end" };
    if (/failed$/.test(t)) return { phase: "brief", transition: "fail" };
    return { phase: "brief", transition: "touch" };
  }

  // mission (expert.* + coordinator.* — non case-prefixed)
  if (t.startsWith("expert.") || t === "coordinator.synthesizing" ||
      t === "coordinator.candidates_ready" || t === "coordinator.aggregating" ||
      t === "refs_pack.generated") {
    if (t === "mission.failed") return { phase: "mission", transition: "fail" };
    if (/completed$|ready$|done$/.test(t)) return { phase: "mission", transition: "touch" };
    return { phase: "mission", transition: "start" };
  }
  if (t === "mission.failed") return { phase: "mission", transition: "fail" };

  // overview
  if (t === "overview.started") return { phase: "overview", transition: "start" };
  if (t === "overview.completed") return { phase: "overview", transition: "end" };
  if (t === "overview.failed") return { phase: "overview", transition: "fail" };

  // cases
  if (t.startsWith("case_expert.") || t.startsWith("case_coordinator.")) {
    if (/failed$/.test(t)) return { phase: "case", transition: "fail" };
    if (/completed$|done$/.test(t)) return { phase: "case", transition: "touch" };
    return { phase: "case", transition: "start" };
  }
  if (t === "cases.selected") return { phase: "case", transition: "end" };

  // evidence
  if (t === "evidence.updated") return { phase: "evidence", transition: "start" };
  if (t === "evidence.submitted") return { phase: "evidence", transition: "end" };

  // writer
  if (t === "writer.section_started") return { phase: "writer", transition: "start" };
  if (t === "writer.section_completed") return { phase: "writer", transition: "touch" };
  if (t === "writer.section_failed") return { phase: "writer", transition: "fail" };
  if (t === "writer.completed" || t === "writer.final_rebuilt") return { phase: "writer", transition: "end" };
  if (t.startsWith("writer.")) return { phase: "writer", transition: "start" };

  return null;
}

export function eventLabel(ev: StreamEvent): string {
  const t = ev.type;
  const d = (ev.data ?? ev.payload ?? {}) as any;
  const expert = d.expert ?? d.name;
  const section = d.sectionKey ?? d.section_key ?? d.section;
  const round = d.round;

  switch (t) {
    case "state_changed": return `状态: ${d.from ?? "?"} → ${d.to ?? "?"}`;
    case "agent.started": return `Agent ${ev.agent ?? d.agent ?? ""} 启动`;
    case "agent.completed": return `Agent ${ev.agent ?? d.agent ?? ""} 完成`;
    case "agent.failed": return `Agent ${ev.agent ?? d.agent ?? ""} 失败`;
    case "agent.warning": return `Agent ${ev.agent ?? d.agent ?? ""} 警告`;
    case "expert.round1_started": return `专家 ${expert ?? ""} 开始 Round 1`;
    case "expert.round1_completed": return `专家 ${expert ?? ""} 完成 Round 1`;
    case "expert.round2_started": return `专家 ${expert ?? ""} 开始 Round 2`;
    case "expert.round2_completed": return `专家 ${expert ?? ""} 完成 Round 2`;
    case "coordinator.synthesizing": return "协调员 正在合成";
    case "coordinator.aggregating": return "协调员 正在汇总";
    case "coordinator.candidates_ready": return "候选方案就绪";
    case "refs_pack.generated": return "Refs pack 已生成";
    case "mission.failed": return "Mission 失败";
    case "overview.started": return "Overview 开始";
    case "overview.completed": return "Overview 完成";
    case "overview.failed": return "Overview 失败";
    case "case_expert.round1_started": return `案例专家 ${expert ?? ""} 开始 Round 1`;
    case "case_expert.round1_completed": return `案例专家 ${expert ?? ""} 完成 Round 1`;
    case "case_expert.round2_started": return `案例专家 ${expert ?? ""} 开始 Round 2`;
    case "case_expert.round2_completed": return `案例专家 ${expert ?? ""} 完成 Round 2`;
    case "case_coordinator.synthesizing": return "案例协调员 正在合成";
    case "case_coordinator.done": return "案例协调员 完成";
    case "cases.selected": return "案例已选定";
    case "evidence.updated": return "证据已更新";
    case "evidence.submitted": return "证据已提交";
    case "writer.section_started": return `写作 ${section ?? ""} 开始${round ? ` (R${round})` : ""}`;
    case "writer.section_completed": return `写作 ${section ?? ""} 完成`;
    case "writer.section_failed": return `写作 ${section ?? ""} 失败`;
    case "writer.tool_called": return `调用工具 ${d.toolName ?? ""}`;
    case "writer.tool_returned": return `工具 ${d.toolName ?? ""} 返回`;
    case "writer.tool_failed": return `工具 ${d.toolName ?? ""} 失败`;
    case "writer.tool_round_completed": return `工具轮次 ${round ?? ""} 完成`;
    case "writer.selection_rewritten": return "改写选中片段";
    case "writer.final_rebuilt": return "最终稿已重建";
    default: return t;
  }
}

export function deriveAgentPipeline(events: StreamEvent[]): PipelineSnapshot {
  const map = emptyPhases();
  let lastActiveAgent: CurrentActivity | null = null;
  // Track per-agent state to know when an agent ends.
  const agentState = new Map<string, CurrentActivity>();

  for (const ev of events) {
    const cls = classifyPhase(ev);
    if (cls) {
      if (cls.transition === "start") bumpRunning(map, cls.phase);
      else if (cls.transition === "end") markDone(map, cls.phase);
      else if (cls.transition === "fail") markFailed(map, cls.phase);
      // touch — leave current state alone (could be running or done already)
    }

    const d = (ev.data ?? ev.payload ?? {}) as any;
    const agent = ev.agent ?? d.agent ?? d.expert ?? d.name;
    if (agent) {
      const cli = ev.cli ?? d.cli;
      const model = ev.model ?? d.model ?? null;
      const round: number | null = typeof d.round === "number"
        ? d.round
        : /round1/.test(ev.type) ? 1 : /round2/.test(ev.type) ? 2 : null;
      const prev = agentState.get(agent);
      const startedAt = prev?.startedAt ?? ev.ts;
      let status: CurrentActivity["status"] = "running";
      if (/failed$/.test(ev.type)) status = "failed";
      else if (/completed$|done$|ready$/.test(ev.type) && ev.type !== "coordinator.candidates_ready") {
        status = "done";
      }
      const activity: CurrentActivity = {
        agent,
        cli: cli ?? prev?.cli,
        model: model ?? prev?.model ?? null,
        round,
        description: eventLabel(ev),
        startedAt,
        status,
      };
      agentState.set(agent, activity);
      lastActiveAgent = activity;
    }
  }

  // Make sure phase order — once a later phase starts, earlier still-running phases are considered done.
  const order: PhaseKey[] = ["brief", "mission", "overview", "case", "evidence", "writer"];
  for (let i = order.length - 1; i >= 0; i--) {
    const k = order[i]!;
    if (map[k] === "running" || map[k] === "done") {
      for (let j = 0; j < i; j++) {
        const earlier = order[j]!;
        if (map[earlier] === "todo" || map[earlier] === "running") {
          map[earlier] = "done";
        }
      }
      break;
    }
  }

  const phases: Phase[] = PHASE_DEFS.map(({ key, label }) => ({
    key,
    label,
    status: map[key],
  }));

  return { phases, currentActivity: lastActiveAgent };
}

export function formatElapsed(startedAt: string | number | undefined, now: number = Date.now()): string {
  if (startedAt === undefined || startedAt === null || startedAt === "") return "—";
  let started: number;
  if (typeof startedAt === "number") started = startedAt;
  else {
    const parsed = Date.parse(startedAt);
    if (Number.isNaN(parsed)) return "—";
    started = parsed;
  }
  const ms = Math.max(0, now - started);
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m${sec % 60}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h${min % 60}m`;
}

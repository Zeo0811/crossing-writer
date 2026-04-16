import type { ActiveAgent, StreamEvent } from "../../hooks/useProjectStream";

export type SectionKey = "brief" | "mission" | "overview" | "case" | "evidence" | "article";

const AGENT_PREFIXES: Record<SectionKey, (agent: string) => boolean> = {
  brief: (a) => a === "brief_analyst",
  mission: (a) => a === "coordinator" || a.startsWith("topic_expert."),
  overview: (a) => a === "product_overview",
  case: (a) => a === "case_coordinator" || a.startsWith("case_expert."),
  evidence: () => false,
  article: (a) => a.startsWith("writer.") || a.startsWith("practice."),
};

const SECTION_ORDER: Array<{ key: SectionKey; states: string[] }> = [
  { key: "brief", states: ["brief_uploaded", "brief_analyzing", "brief_ready", "awaiting_expert_selection", "round1_running", "synthesizing", "round2_running"] },
  { key: "mission", states: ["awaiting_mission_pick"] },
  { key: "overview", states: ["mission_approved", "awaiting_overview_input", "overview_analyzing", "overview_ready", "overview_failed"] },
  { key: "case", states: ["awaiting_case_expert_selection", "case_planning_running", "case_planning_failed", "case_synthesizing", "awaiting_case_selection", "case_plan_approved"] },
  { key: "evidence", states: ["evidence_collecting", "evidence_ready"] },
  { key: "article", states: ["writing_configuring", "writing_running", "writing_ready", "writing_editing", "writing_failed"] },
];

function sectionIndex(key: SectionKey): number {
  return SECTION_ORDER.findIndex((s) => s.key === key);
}

function currentSectionIdx(projectStatus: string): number {
  return SECTION_ORDER.findIndex((s) => s.states.includes(projectStatus));
}

export function SectionStatusBadge({
  sectionKey,
  projectStatus,
  activeAgents,
  events,
}: {
  sectionKey: SectionKey;
  projectStatus: string;
  activeAgents: ActiveAgent[];
  events: StreamEvent[];
}) {
  const match = AGENT_PREFIXES[sectionKey];
  const myAgents = activeAgents.filter((a) => match(a.agent));
  const running = myAgents.filter((a) => a.status === "online");
  const failedEvents = events.filter((e) =>
    typeof e.type === "string" && e.type.endsWith(".failed") && e.agent && match(e.agent),
  );
  const successorEvents = events.filter((e) =>
    typeof e.type === "string" &&
    /(completed|done|ready)$/.test(e.type) &&
    e.agent && match(e.agent),
  );
  const lastFailed = failedEvents[failedEvents.length - 1];
  const lastSuccess = successorEvents[successorEvents.length - 1];
  const failureLive = lastFailed && (!lastSuccess || (lastSuccess.ts ?? "") < (lastFailed.ts ?? ""));

  let text: string;
  let cls: string;

  if (running.length > 0) {
    const everSeen = new Set<string>();
    for (const ev of events) {
      if (ev.agent && match(ev.agent)) everSeen.add(ev.agent);
    }
    for (const a of activeAgents) if (match(a.agent)) everSeen.add(a.agent);
    const total = everSeen.size || running.length;
    text = `${running.length}/${total} 运行中 🟢`;
    cls = "bg-[var(--accent-fill)] text-[var(--accent)] border-[var(--accent-soft)]";
  } else if (failureLive) {
    text = "失败 🔴";
    cls = "bg-[rgba(255,107,107,0.08)] text-[var(--red)] border-[var(--red)]";
  } else {
    const myIdx = sectionIndex(sectionKey);
    const currIdx = currentSectionIdx(projectStatus);
    if (currIdx < 0 || myIdx < 0) {
      text = "pending";
      cls = "bg-[var(--bg-2)] text-[var(--faint)] border-[var(--hair)]";
    } else if (myIdx < currIdx) {
      text = "completed";
      cls = "bg-[var(--bg-2)] text-[var(--meta)] border-[var(--hair)]";
    } else if (myIdx === currIdx) {
      text = "进行中";
      cls = "bg-[var(--accent-fill)] text-[var(--accent)] border-[var(--accent-soft)]";
    } else {
      text = "待开始";
      cls = "bg-[var(--bg-2)] text-[var(--faint)] border-[var(--hair)]";
    }
  }

  return (
    <span
      data-testid="section-badge"
      className={`inline-block ml-2 text-[10px] px-1.5 py-0.5 rounded border ${cls}`}
    >
      {text}
    </span>
  );
}

import { useEffect, useRef, useState, useCallback } from "react";

export interface ActiveAgent {
  agent: string;
  cli?: string;
  model?: string | null;
  stage: string;
  status?: "online" | "failed";
}

export interface StreamEvent {
  ts?: string | number;
  type: string;
  agent?: string;
  cli?: string;
  model?: string | null;
  data?: Record<string, any>;
  payload?: any;
  [k: string]: any;
}

export type ConnectionState = "connecting" | "connected" | "reconnecting" | "disconnected";

const STARTED_RE = /\.(started|round1_started|round2_started|synthesizing|analyzing|generating)$/;
const ENDED_RE = /\.(completed|done|ready|round1_completed|round2_completed|failed)$/;

const EVENT_TYPES = [
  "state_changed",
  "agent.started", "agent.completed", "agent.failed",
  "expert.round1_started", "expert.round1_completed",
  "expert.round2_started", "expert.round2_completed",
  "coordinator.synthesizing", "coordinator.candidates_ready", "coordinator.aggregating",
  "refs_pack.generated",
  "overview.started", "overview.completed", "overview.failed",
  "case_expert.round1_started", "case_expert.round1_completed",
  "case_expert.round2_started", "case_expert.round2_completed",
  "case_expert.tool_call", "case_expert.failed",
  "case_coordinator.synthesizing", "case_coordinator.done",
  "cases.selected",
  "evidence.updated",
  "evidence.submitted",
  "writer.section_started",
  "writer.section_completed",
  "writer.section_failed",
  "writer.rewrite_chunk",
  "writer.rewrite_completed",
  "writer.rewrite_failed",
  "writer.style_critic_applied",
  "writer.final_rebuilt",
  "writer.tool_called",
  "writer.tool_returned",
  "writer.tool_failed",
  "writer.tool_round_completed",
  "writer.selection_rewritten",
  // SP-10: role-scoped distill + run gating
  "distill.started",
  "distill.slicer_progress",
  // SP-15: slicer cache hit (per article)
  "distill.slicer_cache_hit",
  "distill.composer_done",
  "distill.finished",
  "distill.failed",
  "run.blocked",
  // SP-12: topic-expert consult
  "topic_consult.started",
  "expert_started",
  "expert_delta",
  "expert_done",
  "expert_failed",
  "all_done",
];

// ============================================================================
// SP-12 topic-expert consult event payloads + reducer
// ============================================================================

export type TopicExpertInvokeType = "score" | "structure" | "continue";

export interface TopicConsultStartedPayload {
  invokeType: TopicExpertInvokeType;
  selected: string[];
}
export interface ExpertStartedPayload { name: string }
export interface ExpertDeltaPayload { name: string; chunk: string }
export interface ExpertDonePayload {
  name: string;
  markdown: string;
  tokens?: number | null;
  meta?: { cli: string; model?: string | null; durationMs: number };
}
export interface ExpertFailedPayload { name: string; error: string }
export interface AllDonePayload { succeeded: string[]; failed: string[] }

export interface TopicConsultExpertState {
  status: "pending" | "running" | "done" | "failed";
  markdown: string;
  error?: string;
}

export interface TopicConsultState {
  status: "idle" | "running" | "done";
  invokeType?: TopicExpertInvokeType;
  experts: Record<string, TopicConsultExpertState>;
  succeeded: string[];
  failed: string[];
}

export function initialTopicConsultState(): TopicConsultState {
  return { status: "idle", experts: {}, succeeded: [], failed: [] };
}

export function reduceTopicConsult(
  state: TopicConsultState,
  event: { type: string; data: Record<string, unknown> },
): TopicConsultState {
  const d = event.data ?? {};
  switch (event.type) {
    case "topic_consult.started": {
      const p = d as unknown as TopicConsultStartedPayload;
      const experts: Record<string, TopicConsultExpertState> = {};
      for (const n of p.selected ?? []) {
        experts[n] = { status: "pending", markdown: "" };
      }
      return {
        status: "running",
        invokeType: p.invokeType,
        experts,
        succeeded: [],
        failed: [],
      };
    }
    case "expert_started": {
      const { name } = d as unknown as ExpertStartedPayload;
      return {
        ...state,
        experts: {
          ...state.experts,
          [name]: { ...(state.experts[name] ?? { markdown: "" }), status: "running" },
        },
      };
    }
    case "expert_delta": {
      const { name, chunk } = d as unknown as ExpertDeltaPayload;
      const prev = state.experts[name] ?? { status: "running", markdown: "" };
      return {
        ...state,
        experts: {
          ...state.experts,
          [name]: { ...prev, status: "running", markdown: prev.markdown + chunk },
        },
      };
    }
    case "expert_done": {
      const { name, markdown } = d as unknown as ExpertDonePayload;
      return {
        ...state,
        experts: {
          ...state.experts,
          [name]: { status: "done", markdown },
        },
      };
    }
    case "expert_failed": {
      const { name, error } = d as unknown as ExpertFailedPayload;
      return {
        ...state,
        experts: {
          ...state.experts,
          [name]: {
            ...(state.experts[name] ?? { markdown: "" }),
            status: "failed",
            error,
          },
        },
      };
    }
    case "all_done": {
      const { succeeded, failed } = d as unknown as AllDonePayload;
      return { ...state, status: "done", succeeded, failed };
    }
    default:
      return state;
  }
}

export function useProjectStream(projectId: string | undefined) {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [activeAgents, setActiveAgents] = useState<ActiveAgent[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [lastEventTs, setLastEventTs] = useState<number | null>(null);
  const errorCountRef = useRef(0);

  const applyEvent = useCallback((ev: StreamEvent) => {
    setEvents((prev) => [...prev, ev]);
    setLastEventTs(Date.now());
    setActiveAgents((prev) => {
      const d = (ev.data ?? {}) as any;
      const agent = ev.agent ?? d.agent;
      if (!agent) return prev;
      const cli = ev.cli ?? d.cli;
      const model = ev.model ?? d.model ?? null;
      const stageMatch = ev.type.match(/\.([a-z_0-9]+)$/);
      const stage = stageMatch?.[1] ?? "unknown";
      if (STARTED_RE.test(ev.type)) {
        const next = prev.filter((a) => a.agent !== agent);
        next.push({ agent, cli, model, stage, status: "online" });
        return next;
      }
      if (ENDED_RE.test(ev.type)) {
        if (ev.type.endsWith("failed")) {
          return prev.map((a) => a.agent === agent ? { ...a, status: "failed" as const } : a);
        }
        return prev.filter((a) => a.agent !== agent);
      }
      return prev;
    });
  }, []);

  useEffect(() => {
    if (!projectId) return;
    setConnectionState("connecting");
    errorCountRef.current = 0;
    const url = `/api/projects/${projectId}/stream`;
    console.log("[SSE] opening", url);
    const es = new EventSource(url);
    es.onopen = () => {
      console.log("[SSE] opened");
      setConnectionState("connected");
      errorCountRef.current = 0;
    };
    es.onerror = (e) => {
      console.warn("[SSE] error", e);
      errorCountRef.current += 1;
      setConnectionState(errorCountRef.current >= 3 ? "disconnected" : "reconnecting");
    };
    EVENT_TYPES.forEach((t) => {
      es.addEventListener(t, (e: MessageEvent) => {
        console.log("[SSE] event", t, e.data?.slice?.(0, 120));
        try {
          const parsed = JSON.parse(e.data);
          const ev: StreamEvent = {
            ...(parsed && typeof parsed === "object" ? parsed : {}),
            type: t,
            payload: parsed,
          };
          applyEvent(ev);
        } catch (err) {
          console.warn("[SSE] parse fail", err);
        }
      });
    });
    return () => es.close();
  }, [projectId, applyEvent]);

  return { events, activeAgents, connectionState, lastEventTs, __injectForTest: applyEvent };
}

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
];

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

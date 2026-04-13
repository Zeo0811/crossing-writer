import { useEffect, useRef, useState, useCallback } from "react";

export interface ActiveAgent {
  agent: string;
  cli?: string;
  model?: string | null;
  stage: string;
  status?: "online" | "failed";
}

export interface StreamEvent {
  ts: string;
  type: string;
  agent?: string;
  cli?: string;
  model?: string | null;
  data?: Record<string, any>;
  [k: string]: any;
}

const STARTED_RE = /\.(started|round1_started|round2_started|synthesizing|analyzing|generating)$/;
const ENDED_RE = /\.(completed|done|ready|round1_completed|round2_completed|failed)$/;

export function useProjectStream(projectId: string | undefined) {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [activeAgents, setActiveAgents] = useState<ActiveAgent[]>([]);
  const esRef = useRef<EventSource | null>(null);

  const applyEvent = useCallback((ev: StreamEvent) => {
    setEvents((prev) => [...prev, ev]);
    setActiveAgents((prev) => {
      const agent = ev.agent;
      if (!agent) return prev;
      const stageMatch = ev.type.match(/\.([a-z_0-9]+)$/);
      const stage = stageMatch?.[1] ?? "unknown";
      if (STARTED_RE.test(ev.type)) {
        const next = prev.filter((a) => a.agent !== agent);
        next.push({
          agent,
          cli: ev.cli,
          model: ev.model ?? null,
          stage,
          status: "online",
        });
        return next;
      }
      if (ENDED_RE.test(ev.type)) {
        if (ev.type.endsWith("failed")) {
          return prev.map((a) =>
            a.agent === agent ? { ...a, status: "failed" } : a,
          );
        }
        return prev.filter((a) => a.agent !== agent);
      }
      return prev;
    });
  }, []);

  useEffect(() => {
    if (!projectId) return;
    const es = new EventSource(`/api/projects/${projectId}/stream`);
    esRef.current = es;
    const handler = (e: MessageEvent) => {
      try {
        applyEvent(JSON.parse(e.data) as StreamEvent);
      } catch {
        /* ignore parse failures */
      }
    };
    const types = [
      "state_changed",
      "agent.started",
      "agent.completed",
      "agent.failed",
      "expert.round1_started",
      "expert.round1_completed",
      "expert.round2_started",
      "expert.round2_completed",
      "coordinator.synthesizing",
      "coordinator.candidates_ready",
      "coordinator.aggregating",
      "refs_pack.generated",
    ];
    types.forEach((t) => es.addEventListener(t, handler));
    es.onerror = () => {
      /* browser auto-reconnect */
    };
    return () => es.close();
  }, [projectId, applyEvent]);

  return { events, activeAgents, __injectForTest: applyEvent };
}

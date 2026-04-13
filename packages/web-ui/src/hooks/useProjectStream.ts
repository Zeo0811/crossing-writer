import { useEffect, useState } from "react";

export interface StreamEvent {
  ts: string;
  type: string;
  data: Record<string, any>;
}

export function useProjectStream(projectId: string | undefined) {
  const [events, setEvents] = useState<StreamEvent[]>([]);

  useEffect(() => {
    if (!projectId) return;
    const es = new EventSource(`/api/projects/${projectId}/stream`);
    const handler = (e: MessageEvent) => {
      try {
        setEvents((prev) => [...prev, JSON.parse(e.data) as StreamEvent]);
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
  }, [projectId]);

  return events;
}

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getProjectChecklist,
  type ProjectChecklistPayload,
} from "../api/client";
import { useProjectStream } from "./useProjectStream";

const REFETCH_EVENT_TYPES = new Set([
  "project.updated",
  "brief.ready",
  "mission.selected",
  "case.finalized",
  "cases.selected",
  "evidence.updated",
  "evidence.submitted",
  "writer.section_completed",
  "writer.final_rebuilt",
  "style.binding.updated",
  "run.blocked",
  "state_changed",
]);

export interface UseProjectChecklistResult {
  data: ProjectChecklistPayload | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useProjectChecklist(projectId: string | undefined): UseProjectChecklistResult {
  const [data, setData] = useState<ProjectChecklistPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(projectId));
  const [error, setError] = useState<Error | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const stream = useProjectStream(projectId);
  const lastSeenRef = useRef<number>(0);

  const fetchOnce = useCallback(async () => {
    if (!projectId) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    try {
      const payload = await getProjectChecklist(projectId, { signal: ac.signal });
      if (!ac.signal.aborted) {
        setData(payload);
        setError(null);
      }
    } catch (err) {
      if ((err as any)?.name === "AbortError") return;
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!projectId) {
      setData(null);
      setLoading(false);
      return;
    }
    fetchOnce();
    return () => {
      abortRef.current?.abort();
    };
  }, [projectId, fetchOnce]);

  // React to relevant SSE events
  const events = (stream as { events?: Array<{ type?: string }> }).events ?? [];
  useEffect(() => {
    if (!projectId) return;
    if (events.length <= lastSeenRef.current) return;
    let shouldRefetch = false;
    for (let i = lastSeenRef.current; i < events.length; i++) {
      const t = events[i]?.type;
      if (t && REFETCH_EVENT_TYPES.has(t)) {
        shouldRefetch = true;
        break;
      }
    }
    lastSeenRef.current = events.length;
    if (shouldRefetch) fetchOnce();
  }, [events, fetchOnce, projectId]);

  return { data, loading, error, refetch: fetchOnce };
}

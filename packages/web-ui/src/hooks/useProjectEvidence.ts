import { useEffect, useState, useCallback } from "react";
import { getProjectEvidence, type ProjectEvidence } from "../api/evidence-client";
import { useProjectStream } from "./useProjectStream";

export function useProjectEvidence(projectId: string) {
  const [evidence, setEvidence] = useState<ProjectEvidence | null>(null);
  const { events } = useProjectStream(projectId);

  const reload = useCallback(() => {
    getProjectEvidence(projectId)
      .then(setEvidence)
      .catch(() => setEvidence(null));
  }, [projectId]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    if (events.length === 0) return;
    const last = events[events.length - 1];
    if (!last) return;
    if (last.type === "evidence.updated" || last.type === "evidence.submitted") reload();
  }, [events, reload]);

  return { evidence, reload };
}

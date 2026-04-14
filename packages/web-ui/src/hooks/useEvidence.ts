import { useEffect, useState, useCallback } from "react";
import { getCaseEvidence, type CaseDetail } from "../api/evidence-client";
import { useProjectStream } from "./useProjectStream";

export function useEvidence(projectId: string, caseId: string | null) {
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const { events } = useProjectStream(projectId);

  const reload = useCallback(() => {
    if (!caseId) { setDetail(null); return; }
    setLoading(true);
    getCaseEvidence(projectId, caseId)
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [projectId, caseId]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    if (!caseId || events.length === 0) return;
    const last = events[events.length - 1];
    if (!last) return;
    if (last.type !== "evidence.updated") return;
    const payload = (last.data ?? last) as any;
    if (payload.case_id === caseId) reload();
  }, [events, caseId, reload]);

  return { detail, loading, reload };
}

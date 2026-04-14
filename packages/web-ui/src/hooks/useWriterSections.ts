import { useEffect, useState, useCallback } from "react";
import { getSections, type SectionListItem } from "../api/writer-client";
import { useProjectStream } from "./useProjectStream";

const WRITER_REFRESH_EVENTS = new Set([
  "writer.section_completed",
  "writer.rewrite_completed",
  "writer.style_critic_applied",
  "writer.final_rebuilt",
]);

export function useWriterSections(projectId: string) {
  const [sections, setSections] = useState<SectionListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const { events } = useProjectStream(projectId);

  const reload = useCallback(() => {
    setLoading(true);
    getSections(projectId)
      .then((r) => setSections(r.sections))
      .catch(() => setSections([]))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    if (events.length === 0) return;
    const last = events[events.length - 1];
    if (!last) return;
    if (WRITER_REFRESH_EVENTS.has(last.type)) reload();
  }, [events, reload]);

  return { sections, loading, reload };
}

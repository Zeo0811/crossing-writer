import { useEffect, useState } from "react";
import { getOverview, patchOverview } from "../api/client";

export function useOverview(projectId: string) {
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getOverview(projectId).then((v) => {
      setMarkdown(v); setLoading(false);
    });
  }, [projectId]);

  async function save(next: string) {
    await patchOverview(projectId, next);
    setMarkdown(next);
  }
  return { markdown, loading, save };
}

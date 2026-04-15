import ReactMarkdown from "react-markdown";
import { useQuery } from "@tanstack/react-query";
import { apiMission } from "../../api/client";
import { stripFrontmatter } from "../../utils/markdown";

export function SelectedMissionView({
  projectId,
  selectedPath,
}: {
  projectId: string;
  selectedPath: string;
}) {
  const { data } = useQuery({
    queryKey: ["selected-mission", projectId],
    queryFn: () => apiMission.getCandidates(projectId),
    retry: false,
  });
  return (
    <div className="space-y-3">
      {data && (
        <article className="prose prose-sm max-w-none text-[var(--body)]">
          <ReactMarkdown>{stripFrontmatter(data).body}</ReactMarkdown>
        </article>
      )}
      <p className="text-[10px] text-[var(--faint)]" style={{ fontFamily: "var(--font-mono)" }}>{selectedPath}</p>
    </div>
  );
}

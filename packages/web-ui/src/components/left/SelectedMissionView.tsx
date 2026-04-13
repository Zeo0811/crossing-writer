import ReactMarkdown from "react-markdown";
import { useQuery } from "@tanstack/react-query";
import { apiMission } from "../../api/client";

export function SelectedMissionView({
  projectId,
  selectedPath,
}: {
  projectId: string;
  selectedPath: string;
}) {
  // SP-02 简化：展示 candidates.md（selected.md 包含它）
  const { data } = useQuery({
    queryKey: ["selected-mission", projectId],
    queryFn: () => apiMission.getCandidates(projectId),
    retry: false,
  });
  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">Mission 已选定 ✅</h2>
      {data ? (
        <article
          className="prose max-w-none p-6 rounded border"
          style={{
            background: "var(--green-light)",
            borderColor: "var(--green-border)",
          }}
        >
          <ReactMarkdown>{data}</ReactMarkdown>
        </article>
      ) : null}
      <p className="text-sm text-gray-500 mt-2">selected path: {selectedPath}</p>
    </div>
  );
}

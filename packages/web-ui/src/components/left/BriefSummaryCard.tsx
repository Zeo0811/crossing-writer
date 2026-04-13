import ReactMarkdown from "react-markdown";
import { useBriefSummary } from "../../hooks/useBriefSummary";

export function BriefSummaryCard({ projectId }: { projectId: string }) {
  const { data, isLoading, error } = useBriefSummary(projectId, true);
  if (isLoading) return <div className="text-gray-500">加载摘要…</div>;
  if (error || !data) return <div className="text-gray-500">摘要未生成</div>;
  return (
    <article
      className="prose max-w-none bg-white p-6 rounded border"
      style={{ borderColor: "var(--border)" }}
    >
      <ReactMarkdown>{data}</ReactMarkdown>
    </article>
  );
}

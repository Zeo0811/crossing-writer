import ReactMarkdown from "react-markdown";
import { useBriefSummary } from "../../hooks/useBriefSummary";
import { stripFrontmatter } from "../../utils/markdown";

export function BriefSummaryCard({ projectId }: { projectId: string }) {
  const { data, isLoading, error } = useBriefSummary(projectId, true);
  if (isLoading) return <div className="text-[var(--meta)]">加载摘要…</div>;
  if (error || !data) return <div className="text-[var(--meta)]">摘要未生成</div>;
  const { frontmatter, body } = stripFrontmatter(data);
  return (
    <article
      className="bg-[var(--bg-1)] p-6 rounded border"
      style={{ borderColor: "var(--border)" }}
    >
      {Object.keys(frontmatter).length > 0 && (
        <FrontmatterChips fm={frontmatter} />
      )}
      <div className="prose max-w-none mt-4">
        <ReactMarkdown>{body}</ReactMarkdown>
      </div>
    </article>
  );
}

function FrontmatterChips({ fm }: { fm: Record<string, string> }) {
  const keys = [
    "brand",
    "product",
    "product_category",
    "goal_kind",
    "deadline",
    "confidence",
  ];
  return (
    <dl className="flex flex-wrap gap-2 text-xs">
      {keys
        .filter((k) => fm[k] && fm[k] !== "null")
        .map((k) => (
          <span
            key={k}
            className="px-2 py-0.5 rounded border bg-[var(--gray-light)]"
            style={{ borderColor: "var(--border)" }}
          >
            <span className="text-[var(--meta)] mr-1">{k}:</span>
            <span className="font-medium">{fm[k]}</span>
          </span>
        ))}
    </dl>
  );
}

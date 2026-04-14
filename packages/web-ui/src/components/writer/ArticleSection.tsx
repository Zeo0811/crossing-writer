import { useWriterSections } from "../../hooks/useWriterSections";

export interface ArticleSectionProps {
  projectId: string;
  status: string;
}

export function ArticleSection({ projectId, status }: ArticleSectionProps) {
  const { sections } = useWriterSections(projectId);

  if (status === "evidence_ready" || status === "writing_configuring") {
    return <div className="p-3 text-sm text-gray-600">SP-04 已完成。在右栏配置写作参数并开始。</div>;
  }
  if (status === "writing_running") {
    return <div className="p-3 text-sm">{sections.length} 段完成（进行中）</div>;
  }

  const opening = sections.find((s) => s.key === "opening");
  const closing = sections.find((s) => s.key === "closing");
  const practice = sections.filter((s) => s.key.startsWith("practice.case-"));

  const refAccounts = [...new Set(sections.flatMap((s) => s.frontmatter.reference_accounts ?? []))];

  return (
    <div className="p-3 flex flex-col gap-1 text-sm">
      {opening && (
        <div>📝 开头 <span className="text-xs text-gray-500">{opening.frontmatter.last_agent}</span></div>
      )}
      <div>📝 实测</div>
      {practice.map((p) => (
        <div key={p.key} className="ml-4">
          ├ {p.key.slice("practice.".length)} <span className="text-xs text-gray-500">{p.frontmatter.last_agent}</span>
        </div>
      ))}
      {closing && (
        <div>📝 结尾 <span className="text-xs text-gray-500">{closing.frontmatter.last_agent}</span></div>
      )}
      {refAccounts.length > 0 && <div className="text-xs text-gray-500 mt-2">参考账号: {refAccounts.join(" / ")}</div>}
      <a href={`/api/projects/${projectId}/writer/final`} download="final.md" className="mt-2 px-2 py-1 bg-gray-200 rounded text-center">导出 final.md</a>
    </div>
  );
}

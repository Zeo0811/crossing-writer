import { useParams, Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { useProject } from "../hooks/useProjects";
import { useBriefSummary } from "../hooks/useBriefSummary";
import { BriefIntakeForm } from "../components/right/BriefIntakeForm";

export function ProjectWorkbench() {
  const { id } = useParams<{ id: string }>();
  const { data: project, refetch } = useProject(id);

  if (!project || !id) return <div className="p-6">加载中…</div>;

  const status = project.status;
  const showSummary =
    status === "brief_ready" ||
    status === "awaiting_expert_selection" ||
    status === "round1_running" ||
    status === "synthesizing" ||
    status === "round2_running" ||
    status === "awaiting_mission_pick" ||
    status === "mission_approved";

  return (
    <div className="h-screen flex flex-col">
      <header
        className="p-4 border-b bg-white flex items-center gap-3"
        style={{ borderColor: "var(--border)" }}
      >
        <Link to="/" className="text-sm text-gray-500">
          ← 列表
        </Link>
        <h1 className="font-semibold">{project.name}</h1>
        <span className="text-xs px-2 py-0.5 rounded bg-gray-100">
          {project.status}
        </span>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* 左侧草稿区 */}
        <div
          className="w-3/5 border-r overflow-auto p-6"
          style={{ borderColor: "var(--border)" }}
        >
          {status === "created" ? (
            <div className="text-gray-500">右侧上传 Brief 开始</div>
          ) : showSummary ? (
            <BriefSummaryPane projectId={id} />
          ) : (
            <div className="text-gray-500">Brief Analyst 运行中…（稍候 1-2 分钟）</div>
          )}
        </div>

        {/* 右侧工作区 */}
        <div className="w-2/5 overflow-auto p-6 bg-[var(--gray-light)] space-y-4">
          {status === "created" && (
            <BriefIntakeForm projectId={id} onUploaded={() => refetch()} />
          )}
          {(status === "brief_uploaded" || status === "brief_analyzing") && (
            <div className="p-4 bg-white rounded border">
              Brief Analyst 运行中…
            </div>
          )}
          {showSummary && (
            <div className="p-4 bg-white rounded border text-gray-500">
              （Task 24 再接入专家选择器和时间线）
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BriefSummaryPane({ projectId }: { projectId: string }) {
  const { data, isLoading, error } = useBriefSummary(projectId, true);
  if (isLoading) return <div className="text-gray-500">加载摘要…</div>;
  if (error) return <div className="text-gray-500">摘要未生成</div>;
  if (!data) return null;
  return (
    <article
      className="prose max-w-none bg-white p-6 rounded border"
      style={{ borderColor: "var(--border)" }}
    >
      <ReactMarkdown>{data}</ReactMarkdown>
    </article>
  );
}

import { useParams, Link } from "react-router-dom";
import { useProject } from "../hooks/useProjects";
import { BriefIntakeForm } from "../components/right/BriefIntakeForm";
import { ExpertSelector } from "../components/right/ExpertSelector";
import { AgentTimeline } from "../components/right/AgentTimeline";
import { BriefSummaryCard } from "../components/left/BriefSummaryCard";
import { MissionCandidatesPanel } from "../components/left/MissionCandidateCard";
import { SelectedMissionView } from "../components/left/SelectedMissionView";

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

  const showExpertSelector =
    status === "brief_ready" || status === "awaiting_expert_selection";

  const showCandidates = status === "awaiting_mission_pick";
  const showSelected = status === "mission_approved";

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
        {/* 左侧：草稿/摘要/候选/最终 Mission */}
        <div
          className="w-3/5 border-r overflow-auto p-6 space-y-6"
          style={{ borderColor: "var(--border)" }}
        >
          {status === "created" ? (
            <div className="text-gray-500">右侧上传 Brief 开始</div>
          ) : null}
          {(status === "brief_uploaded" || status === "brief_analyzing") && (
            <div className="text-gray-500">Brief Analyst 运行中…（稍候 1-2 分钟）</div>
          )}
          {showSummary && <BriefSummaryCard projectId={id} />}
          {showCandidates && !showSelected && (
            <MissionCandidatesPanel projectId={id} onSelected={() => refetch()} />
          )}
          {showSelected && project.mission.selected_path && (
            <SelectedMissionView
              projectId={id}
              selectedPath={project.mission.selected_path}
            />
          )}
        </div>

        {/* 右侧：表单/专家选择/时间线 */}
        <div className="w-2/5 overflow-auto p-6 bg-[var(--gray-light)] space-y-4">
          {status === "created" && (
            <BriefIntakeForm projectId={id} onUploaded={() => refetch()} />
          )}
          {(status === "brief_uploaded" || status === "brief_analyzing") && (
            <div className="p-4 bg-white rounded border">Brief Analyst 运行中…</div>
          )}
          {showExpertSelector && (
            <ExpertSelector projectId={id} onStarted={() => refetch()} />
          )}
          {(status === "round1_running" ||
            status === "synthesizing" ||
            status === "round2_running") && (
            <div className="p-4 bg-white rounded border text-gray-500">
              专家评审中（见下面时间线）
            </div>
          )}
          <AgentTimeline projectId={id} />
        </div>
      </div>
    </div>
  );
}

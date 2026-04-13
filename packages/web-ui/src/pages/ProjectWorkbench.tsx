import { useParams, Link } from "react-router-dom";
import { useProject } from "../hooks/useProjects";
import { useProjectStream } from "../hooks/useProjectStream";
import { BriefIntakeForm } from "../components/right/BriefIntakeForm";
import { ExpertSelector } from "../components/right/ExpertSelector";
import { AgentTimeline } from "../components/status/AgentTimeline";
import { AgentStatusBar } from "../components/status/AgentStatusBar";
import { BriefSummaryCard } from "../components/left/BriefSummaryCard";
import { MissionCandidatesPanel } from "../components/left/MissionCandidateCard";
import { SelectedMissionView } from "../components/left/SelectedMissionView";
import { ProductOverviewCard } from "../components/left/ProductOverviewCard";
import { SectionAccordion, Section } from "../components/layout/SectionAccordion";

const SECTION_ORDER: Array<{ key: string; activeStates: string[] }> = [
  {
    key: "brief",
    activeStates: ["brief_uploaded", "brief_analyzing", "brief_ready", "awaiting_expert_selection", "round1_running", "synthesizing", "round2_running"],
  },
  {
    key: "mission",
    activeStates: ["awaiting_mission_pick", "mission_approved"],
  },
  {
    key: "overview",
    activeStates: ["awaiting_overview_input", "overview_analyzing", "overview_ready", "overview_failed"],
  },
  {
    key: "case",
    activeStates: ["awaiting_case_expert_selection", "case_planning_running", "case_planning_failed", "case_synthesizing", "awaiting_case_selection", "case_plan_approved"],
  },
];

function sectionStatusFor(key: string, projectStatus: string): "completed" | "active" | "pending" {
  const currentIdx = SECTION_ORDER.findIndex((s) => s.activeStates.includes(projectStatus));
  const myIdx = SECTION_ORDER.findIndex((s) => s.key === key);
  if (myIdx < 0) return "pending";
  if (currentIdx < 0) return "pending";
  if (myIdx < currentIdx) return "completed";
  if (myIdx === currentIdx) return "active";
  return "pending";
}

export function ProjectWorkbench() {
  const { id } = useParams<{ id: string }>();
  const { data: project, refetch } = useProject(id);
  const { events, activeAgents } = useProjectStream(id);
  if (!project || !id) return <div className="p-6">加载中…</div>;

  const status = project.status;

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
        <AgentStatusBar activeAgents={activeAgents} />
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* 左侧：各阶段内容 */}
        <div
          className="w-3/5 border-r overflow-auto p-6"
          style={{ borderColor: "var(--border)" }}
        >
          {status === "created" ? (
            <div className="text-gray-500">右侧上传 Brief 开始</div>
          ) : (
            <SectionAccordion>
              <Section title="Brief 摘要" status={sectionStatusFor("brief", status)}>
                {(status === "brief_uploaded" || status === "brief_analyzing") ? (
                  <div className="text-gray-500">Brief Analyst 运行中…（稍候 1-2 分钟）</div>
                ) : (
                  <BriefSummaryCard projectId={id} />
                )}
              </Section>

              <Section title="Mission 选定" status={sectionStatusFor("mission", status)}>
                {showCandidates && !showSelected ? (
                  <MissionCandidatesPanel projectId={id} onSelected={() => refetch()} />
                ) : showSelected && project.mission.selected_path ? (
                  <SelectedMissionView
                    projectId={id}
                    selectedPath={project.mission.selected_path}
                  />
                ) : null}
              </Section>

              <Section title="产品概览" status={sectionStatusFor("overview", status)}>
                <ProductOverviewCard projectId={id} status={status} />
              </Section>

              <Section title="Case 列表" status={sectionStatusFor("case", status)}>
                <div>待开始</div>
              </Section>
            </SectionAccordion>
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
          <AgentTimeline events={events} />
        </div>
      </div>
    </div>
  );
}

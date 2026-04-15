import { useParams } from "react-router-dom";
import { useMock } from "../MockProvider";
import { PhaseSteps } from "../components/PhaseSteps";
import { BriefUpload } from "../components/phases/BriefUpload";
import { BriefAnalyzingView, BriefReadyView } from "../components/phases/BriefStatusViews";
import { MissionPhase } from "../components/phases/MissionPhase";
import { OverviewPhase } from "../components/phases/OverviewPhase";
import { CasePhase } from "../components/phases/CasePhase";
import { EvidencePhase } from "../components/phases/EvidencePhase";
import { WritingPhase } from "../components/phases/WritingPhase";
import { MockPlaceholder } from "./MockPlaceholder";

export function MockProjectWorkbench() {
  const { id } = useParams();
  const m = useMock();
  const project = m.projects.find((p) => p.id === id);
  if (!project) return <div className="p-12 text-center text-[var(--meta)]">项目不存在</div>;

  const status = project.id === m.hero.id ? m.heroStatus : project.status;

  return (
    <div className="rounded border border-[var(--hair)] bg-[var(--bg-1)] overflow-hidden">
      <header className="flex items-center justify-between px-6 h-12 border-b border-[var(--hair)]">
        <h1 className="text-base text-[var(--heading)] font-semibold truncate">{project.name}</h1>
        <button
          className="w-7 h-7 flex items-center justify-center rounded text-[var(--meta)] hover:text-[var(--heading)] hover:bg-[var(--bg-2)]"
          aria-label="项目操作"
          title="项目操作"
        >
          ⋯
        </button>
      </header>

      <div className="px-6 py-4">
        <PhaseSteps status={status} />
      </div>

      <main className="px-6 py-5">{renderPhase(status)}</main>
    </div>
  );
}

function renderPhase(status: string) {
  switch (status) {
    case "created":
      return <BriefUpload />;
    case "brief_uploaded":
    case "brief_analyzing":
      return <BriefAnalyzingView />;
    case "brief_ready":
      return <BriefReadyView />;
    case "awaiting_expert_selection":
    case "round1_running":
    case "round1_failed":
    case "synthesizing":
    case "round2_running":
    case "round2_failed":
    case "awaiting_mission_pick":
    case "mission_approved":
      return <MissionPhase />;
    case "awaiting_overview_input":
    case "overview_analyzing":
    case "overview_failed":
    case "overview_ready":
      return <OverviewPhase />;
    case "awaiting_case_expert_selection":
    case "case_planning_running":
    case "case_planning_failed":
    case "case_synthesizing":
    case "awaiting_case_selection":
    case "case_plan_approved":
      return <CasePhase />;
    case "evidence_collecting":
    case "evidence_ready":
      return <EvidencePhase />;
    case "writing_configuring":
    case "writing_running":
    case "writing_failed":
    case "writing_ready":
    case "writing_editing":
      return <WritingPhase />;
    default:
      return <MockPlaceholder checkpoint={9} label={`未识别状态：${status}`} />;
  }
}

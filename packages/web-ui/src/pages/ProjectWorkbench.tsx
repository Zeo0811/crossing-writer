import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { getProject } from "../api/client";
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
import { SectionStatusBadge } from "../components/status/SectionStatusBadge";
import { OverviewIntakeForm } from "../components/right/OverviewIntakeForm";
import { CaseExpertSelector } from "../components/right/CaseExpertSelector";
import { CaseListPanel } from "../components/left/CaseListPanel";
import { CaseSelectedGuide } from "../components/right/CaseSelectedGuide";
import { SettingsDrawer } from "../components/settings/SettingsDrawer";
import { EvidenceSection } from "../components/evidence/EvidenceSection";
import { EvidenceIntakeForm } from "../components/evidence/EvidenceIntakeForm";

type SecStat = "completed" | "active" | "pending";

const SECTION_ORDER: Array<{ key: string; activeStates: string[] }> = [
  {
    key: "brief",
    activeStates: ["brief_uploaded", "brief_analyzing", "brief_ready", "awaiting_expert_selection", "round1_running", "synthesizing", "round2_running"],
  },
  {
    key: "mission",
    activeStates: ["awaiting_mission_pick"],
  },
  {
    key: "overview",
    activeStates: ["mission_approved", "awaiting_overview_input", "overview_analyzing", "overview_ready", "overview_failed"],
  },
  {
    key: "case",
    activeStates: ["awaiting_case_expert_selection", "case_planning_running", "case_planning_failed", "case_synthesizing", "awaiting_case_selection", "case_plan_approved"],
  },
  {
    key: "evidence",
    activeStates: ["evidence_collecting", "evidence_ready"],
  },
];

function sectionStatusFor(key: string, projectStatus: string): SecStat {
  const currentIdx = SECTION_ORDER.findIndex((s) => s.activeStates.includes(projectStatus));
  const myIdx = SECTION_ORDER.findIndex((s) => s.key === key);
  if (myIdx < 0) return "pending";
  if (currentIdx < 0) return "pending";
  if (myIdx < currentIdx) return "completed";
  if (myIdx === currentIdx) return "active";
  return "pending";
}

function findLastFailure(events: any[]): { agent?: string; cli?: string; model?: string | null; error?: string } | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (typeof e.type === "string" && e.type.endsWith(".failed")) {
      const d = e.data ?? e;
      return { agent: d.agent, cli: d.cli, model: d.model, error: d.error };
    }
  }
  return null;
}

function FailureCard({ title, fail, onRetry }: { title: string; fail: any; onRetry?: () => void }) {
  return (
    <div className="p-4 bg-red-50 border border-red-300 rounded">
      <h3 className="font-semibold text-red-700">{title}</h3>
      {fail?.agent && (
        <p className="text-xs text-gray-600 mt-1">
          {fail.agent} · {fail.cli}/{fail.model ?? "?"}
        </p>
      )}
      <pre className="text-xs whitespace-pre-wrap mt-2 max-h-48 overflow-auto bg-white p-2 border border-red-200">
        {fail?.error ?? "未捕获错误（见右下时间线）"}
      </pre>
      {onRetry && (
        <button onClick={onRetry} className="mt-2 bg-red-600 text-white px-3 py-1 text-sm">
          重试
        </button>
      )}
    </div>
  );
}

function rightPanel(status: string, projectId: string, onRefetch: () => void, events: any[]) {
  // SP-02 Brief/Mission panels
  if (status === "created") {
    return <BriefIntakeForm projectId={projectId} onUploaded={onRefetch} />;
  }
  if (status === "brief_uploaded" || status === "brief_analyzing") {
    return (
      <div className="p-4 bg-white rounded border">Brief Analyst 运行中…</div>
    );
  }
  if (status === "brief_ready" || status === "awaiting_expert_selection") {
    return <ExpertSelector projectId={projectId} onStarted={onRefetch} />;
  }
  if (
    status === "round1_running" ||
    status === "synthesizing" ||
    status === "round2_running"
  ) {
    return (
      <div className="p-4 bg-white rounded border text-gray-500">
        专家评审中（见下面时间线）
      </div>
    );
  }

  // SP-03 Overview/Case panels
  switch (status) {
    case "mission_approved":
    case "awaiting_overview_input":
      return <OverviewIntakeForm projectId={projectId} />;
    case "overview_failed":
      return (
        <div className="space-y-4 p-4">
          <FailureCard title="产品概览生成失败" fail={findLastFailure(events)} />
          <OverviewIntakeForm projectId={projectId} />
        </div>
      );
    case "overview_analyzing":
      return <div className="p-4">正在生成产品概览…</div>;
    case "overview_ready":
      return <div className="p-4">点左侧卡片里的「批准进入 Case 规划」</div>;
    case "awaiting_case_expert_selection":
      return <CaseExpertSelector projectId={projectId} />;
    case "case_planning_failed":
      return (
        <div className="space-y-4 p-4">
          <FailureCard title="Case 规划失败" fail={findLastFailure(events)} />
          <CaseExpertSelector projectId={projectId} />
        </div>
      );
    case "case_planning_running":
    case "case_synthesizing":
      return <div className="p-4">规划中…（看右下时间线）</div>;
    case "awaiting_case_selection":
      return <div className="p-4">请在左侧选 2-4 个 Case</div>;
    case "case_plan_approved":
      return <CaseSelectedGuide projectId={projectId} />;
    default:
      return null;
  }
}

export function ProjectWorkbench({ projectId: propProjectId }: { projectId?: string } = {}) {
  const params = useParams<{ id: string }>();
  const projectId = propProjectId ?? params.id ?? "";

  const [project, setProject] = useState<any>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedEvidenceCase, setSelectedEvidenceCase] = useState<string | null>(null);
  const { events, activeAgents, connectionState, lastEventTs } = useProjectStream(projectId);

  function refetch() {
    getProject(projectId).then(setProject).catch(() => {});
  }

  useEffect(() => {
    if (!projectId) return;
    refetch();
    const id = setInterval(refetch, 2000);
    return () => clearInterval(id);
  }, [projectId]);

  if (!project) return <div>加载中...</div>;
  const status = project.status;

  const showCandidates = status === "awaiting_mission_pick";
  const showSelected = status === "mission_approved";

  return (
    <div className="h-screen flex flex-col">
      <header
        className="p-4 border-b bg-white flex items-center gap-3"
        style={{ borderColor: "var(--border)" }}
      >
        {!propProjectId && (
          <Link to="/" className="text-sm text-gray-500">
            ← 列表
          </Link>
        )}
        <h1 className="font-semibold">{project.name}</h1>
        <span className="text-xs px-2 py-0.5 rounded bg-gray-100">
          {project.status}
        </span>
        <AgentStatusBar activeAgents={activeAgents} />
        <button
          onClick={() => setSettingsOpen(true)}
          className="ml-2 text-lg opacity-70 hover:opacity-100"
          aria-label="settings"
          title="设置"
        >
          ⚙
        </button>
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
              <Section title={<>Brief 摘要 <SectionStatusBadge sectionKey="brief" projectStatus={status} activeAgents={activeAgents} events={events} /></>} status={sectionStatusFor("brief", status)}>
                {(status === "brief_uploaded" || status === "brief_analyzing") ? (
                  <div className="text-gray-500">Brief Analyst 运行中…（稍候 1-2 分钟）</div>
                ) : (
                  <BriefSummaryCard projectId={projectId} />
                )}
              </Section>

              <Section title={<>Mission 选定 <SectionStatusBadge sectionKey="mission" projectStatus={status} activeAgents={activeAgents} events={events} /></>} status={sectionStatusFor("mission", status)}>
                {showCandidates && !showSelected ? (
                  <MissionCandidatesPanel projectId={projectId} onSelected={refetch} />
                ) : showSelected && project.mission?.selected_path ? (
                  <SelectedMissionView
                    projectId={projectId}
                    selectedPath={project.mission.selected_path}
                  />
                ) : null}
              </Section>

              <Section title={<>产品概览 <SectionStatusBadge sectionKey="overview" projectStatus={status} activeAgents={activeAgents} events={events} /></>} status={sectionStatusFor("overview", status)}>
                <ProductOverviewCard projectId={projectId} status={status} />
              </Section>

              <Section title={<>Case 列表 <SectionStatusBadge sectionKey="case" projectStatus={status} activeAgents={activeAgents} events={events} /></>} status={sectionStatusFor("case", status)}>
                <CaseListPanel projectId={projectId} />
              </Section>

              <Section title={<>Evidence <SectionStatusBadge sectionKey="evidence" projectStatus={status} activeAgents={activeAgents} events={events} /></>} status={sectionStatusFor("evidence", status)}>
                {(status === "evidence_collecting" || status === "evidence_ready" || status === "case_plan_approved") ? (
                  <EvidenceSection
                    projectId={projectId}
                    selectedCaseId={selectedEvidenceCase}
                    onSelectCase={setSelectedEvidenceCase}
                  />
                ) : (
                  <div className="text-xs text-gray-400">case_plan_approved 后启用</div>
                )}
              </Section>
            </SectionAccordion>
          )}
        </div>

        {/* 右侧：时间线（顶部）+ 表单/专家选择 */}
        <div className="w-2/5 flex flex-col overflow-hidden bg-[var(--gray-light)]">
          <div className="p-3 border-b bg-white">
            <AgentTimeline events={events} connectionState={connectionState} lastEventTs={lastEventTs} />
          </div>
          <div className="flex-1 overflow-auto p-6 space-y-4">
            {(status === "evidence_collecting" || status === "evidence_ready") ? (
              selectedEvidenceCase
                ? <EvidenceIntakeForm projectId={projectId} caseId={selectedEvidenceCase} />
                : <div className="p-4 text-sm text-gray-500">← 左侧选一个 Case 开始上传 evidence</div>
            ) : rightPanel(status, projectId, refetch, events)}
          </div>
        </div>
      </div>
      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

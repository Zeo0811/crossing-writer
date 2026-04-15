import { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { getProject } from "../api/client";
import { ProjectChecklist, type ChecklistItem } from "../components/project/ProjectChecklist";
import { useProjectChecklist } from "../hooks/useProjectChecklist";
import { useProjectStream } from "../hooks/useProjectStream";
import { BriefIntakeForm } from "../components/right/BriefIntakeForm";
import { ExpertSelector } from "../components/right/ExpertSelector";
import { AgentTimeline } from "../components/status/AgentTimeline";
import { AgentStatusBar } from "../components/status/AgentStatusBar";
import { BriefSummaryCard } from "../components/left/BriefSummaryCard";
import { TopicExpertSummonButton } from "../components/project/TopicExpertSummonButton";
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
import { ArticleSection } from "../components/writer/ArticleSection";
import { WriterConfigForm } from "../components/writer/WriterConfigForm";
import { WriterProgressPanel } from "../components/writer/WriterProgressPanel";
import { ArticleEditor } from "../components/writer/ArticleEditor";
import { ProjectOverridePanel } from "../components/config/ProjectOverridePanel";
import { ContextChip } from "../components/project/ContextChip";
import { TopNav } from "../components/layout/TopNav";
import { Button } from "../components/ui/Button";
import { Chip } from "../components/ui/Chip";

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
  {
    key: "article",
    activeStates: ["writing_configuring", "writing_running", "writing_ready", "writing_editing", "writing_failed"],
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
    <div className="p-4 bg-bg-2 border border-red rounded">
      <h3 className="font-semibold text-red">{title}</h3>
      {fail?.agent && (
        <p className="text-xs text-meta mt-1">
          {fail.agent} · {fail.cli}/{fail.model ?? "?"}
        </p>
      )}
      <pre className="text-xs whitespace-pre-wrap mt-2 max-h-48 overflow-auto bg-bg-1 p-2 border border-hair text-body">
        {fail?.error ?? "未捕获错误（见右下时间线）"}
      </pre>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-2 bg-red text-accent-on px-3 py-1 text-sm border-0 rounded cursor-pointer">
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
          <FailureCard
            title="产品概览生成失败"
            fail={findLastFailure(events)}
            onRetry={async () => {
              const { generateOverview } = await import("../api/client");
              try {
                await generateOverview(projectId, { productUrls: [], userDescription: "" });
                onRefetch();
              } catch (e) {
                window.alert?.(`重试失败：${String(e)}`);
              }
            }}
          />
          <div className="text-xs text-meta px-1">或在下面修改 URL / 补充描述 / 加/删图片后再提交：</div>
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
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [selectedEvidenceCase, setSelectedEvidenceCase] = useState<string | null>(null);
  const { events, activeAgents, connectionState, lastEventTs } = useProjectStream(projectId);
  const { data: checklistData } = useProjectChecklist(projectId);

  const storageKey = `checklist_collapsed_${projectId}`;
  const [checklistCollapsed, setChecklistCollapsed] = useState<boolean>(() => {
    if (!projectId) return false;
    try { return typeof localStorage !== "undefined" && localStorage.getItem(`checklist_collapsed_${projectId}`) === "1"; } catch { return false; }
  });
  useEffect(() => {
    try {
      setChecklistCollapsed(localStorage.getItem(`checklist_collapsed_${projectId}`) === "1");
    } catch { /* noop */ }
  }, [projectId]);
  const toggleChecklistCollapsed = useCallback(() => {
    setChecklistCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem(storageKey, next ? "1" : "0"); } catch { /* noop */ }
      return next;
    });
  }, [storageKey]);

  const handleChipClick = useCallback((item: ChecklistItem) => {
    if (!item.link) return;
    if (item.link === "config") {
      setSettingsOpen(true);
      return;
    }
    if (typeof document !== "undefined") {
      const el = document.querySelector(`[data-section="${item.link}"]`);
      (el as HTMLElement | null)?.scrollIntoView?.({ behavior: "smooth" });
    }
  }, []);

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

  // SP-10: find last run.blocked event (if any) — cleared once a new run.started fires
  let missingBindings: Array<{ agentKey: string; account?: string; role?: string; reason?: string }> = [];
  for (let i = events.length - 1; i >= 0; i--) {
    const e: any = events[i];
    if (e?.type === "run.blocked") {
      const mb = e.missingBindings ?? e.data?.missingBindings ?? [];
      if (Array.isArray(mb)) missingBindings = mb;
      break;
    }
    if (e?.type === "writer.section_started") {
      break; // new run cleared block
    }
  }

  const showCandidates = status === "awaiting_mission_pick";
  const showSelected = status === "mission_approved";
  const showExpertSelector =
    status === "brief_ready" ||
    status === "round1_running" ||
    status === "round1_completed" ||
    status === "round2_running" ||
    status === "round2_completed";
  const missionRunning =
    status === "round1_running" ||
    status === "round1_completed" ||
    status === "round2_running";

  return (
    <div
      data-testid="page-project-workbench"
      className="h-screen flex flex-col bg-bg-0 text-body"
    >
      <div className="px-4 pt-4">
        <TopNav breadcrumb={["projects", project.name]} />
      </div>
      <ProjectChecklist
        items={checklistData?.items ?? []}
        collapsed={checklistCollapsed}
        onToggleCollapsed={toggleChecklistCollapsed}
        onChipClick={handleChipClick}
      />
      <header
        data-testid="pw-sidebar-header"
        className="p-4 border-b bg-bg-1 flex items-center gap-3 border-hair"
      >
        {!propProjectId && (
          <Link to="/" className="text-sm text-meta hover:text-accent no-underline">
            ← 列表
          </Link>
        )}
        <h1 className="font-semibold text-heading m-0">{project.name}</h1>
        <Chip variant="active">{project.status}</Chip>
        <AgentStatusBar activeAgents={activeAgents} />
        <Button
          variant="secondary"
          onClick={() => setOverrideOpen(true)}
          className="ml-2"
          title="本项目专属配置"
        >
          🔧 本项目专属配置
        </Button>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="ml-2 text-lg text-meta hover:text-accent cursor-pointer bg-transparent border-0"
          aria-label="settings"
          title="设置"
        >
          ⚙
        </button>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* 左侧：各阶段内容 */}
        <div
          data-testid="pw-sidebar"
          className="w-3/5 border-r overflow-auto p-6 border-hair bg-bg-0"
        >
          {missingBindings.length > 0 && (
            <div
              className="mb-4 border rounded p-4 border-red bg-[var(--bg-2)]"
              data-testid="run-blocked-card"
            >
              <h3 className="font-semibold mb-2 text-red">
                ⚠️ 无法开始
              </h3>
              <div className="text-sm mb-2 text-body">下列 agent 未绑定风格：</div>
              <ul className="text-xs font-mono-term ml-4 mb-3 text-body">
                {missingBindings.map((mb, i) => (
                  <li key={`${mb.agentKey}-${i}`}>• {mb.agentKey}{mb.reason ? ` (${mb.reason})` : ""}</li>
                ))}
              </ul>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setOverrideOpen(true)}
                >
                  本项目专属配置
                </Button>
                <Link
                  to="/config"
                  className="text-xs px-2 py-1 border border-hair rounded no-underline text-body hover:text-accent"
                >
                  去配置工作台
                </Link>
              </div>
            </div>
          )}
          {status === "created" ? (
            <div className="text-gray-500">右侧上传 Brief 开始</div>
          ) : (
            <SectionAccordion>
              <div data-section="brief">
                <Section title={<>Brief 摘要 <SectionStatusBadge sectionKey="brief" projectStatus={status} activeAgents={activeAgents} events={events} /></>} status={sectionStatusFor("brief", status)}>
                  {(status === "brief_uploaded" || status === "brief_analyzing") ? (
                    <div className="text-gray-500">Brief Analyst 运行中…（稍候 1-2 分钟）</div>
                  ) : (
                    <>
                      <BriefSummaryCard projectId={projectId} />
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          type="button"
                          className="text-xs px-2 py-1 border rounded hover:bg-bg-2"
                          onClick={async () => {
                            const res = await fetch(`/api/projects/${projectId}/brief/reanalyze`, { method: "POST" });
                            if (res.ok) refetch();
                            else window.alert?.(`重新解析失败: HTTP ${res.status}`);
                          }}
                        >
                          🔄 重新解析 Brief
                        </button>
                        <span className="text-xs text-meta">（会覆盖 brief-summary.md）</span>
                      </div>
                      <TopicExpertSummonButton
                        projectId={projectId}
                        briefSummary={project?.brief?.summary ?? undefined}
                      />
                    </>
                  )}
                </Section>
              </div>

              <div data-section="mission">
                <Section title={<>Mission 选定 <SectionStatusBadge sectionKey="mission" projectStatus={status} activeAgents={activeAgents} events={events} /></>} status={sectionStatusFor("mission", status)}>
                  {showCandidates && !showSelected ? (
                    <MissionCandidatesPanel projectId={projectId} onSelected={refetch} />
                  ) : showSelected && project.mission?.selected_path ? (
                    <SelectedMissionView
                      projectId={projectId}
                      selectedPath={project.mission.selected_path}
                    />
                  ) : showExpertSelector && !missionRunning ? (
                    <ExpertSelector projectId={projectId} onStarted={refetch} />
                  ) : missionRunning ? (
                    <div className="p-4 text-sm opacity-80">
                      两轮评审运行中…看右侧 Agent 时间线进度。
                    </div>
                  ) : null}
                </Section>
              </div>

              <div data-section="overview">
                <Section title={<>产品概览 <SectionStatusBadge sectionKey="overview" projectStatus={status} activeAgents={activeAgents} events={events} /></>} status={sectionStatusFor("overview", status)}>
                  <ProductOverviewCard projectId={projectId} status={status} />
                </Section>
              </div>

              <div data-section="case">
                <Section title={<>Case 列表 <SectionStatusBadge sectionKey="case" projectStatus={status} activeAgents={activeAgents} events={events} /></>} status={sectionStatusFor("case", status)}>
                  <CaseListPanel projectId={projectId} />
                </Section>
              </div>

              <div data-section="evidence">
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
              </div>

              <div data-section="article">
                <Section title={<>Article <SectionStatusBadge sectionKey="article" projectStatus={status} activeAgents={activeAgents} events={events} /></>} status={sectionStatusFor("article", status)}>
                  <ArticleSection projectId={projectId} status={status} />
                </Section>
              </div>
            </SectionAccordion>
          )}
        </div>

        {/* 右侧：时间线（顶部）+ 表单/专家选择 */}
        <div className="w-2/5 flex flex-col overflow-hidden bg-bg-2">
          <div className="p-3 border-b bg-bg-1 border-hair">
            <AgentTimeline events={events} connectionState={connectionState} lastEventTs={lastEventTs} />
          </div>
          <div className="flex-1 overflow-auto p-6 space-y-4">
            {(status === "evidence_ready" || status === "writing_configuring") ? (
              <WriterConfigForm
                projectId={projectId}
                defaults={{
                  "writer.opening":    { cli: "claude", model: "opus" },
                  "writer.practice":   { cli: "claude", model: "sonnet" },
                  "writer.closing":    { cli: "claude", model: "opus" },
                  "practice.stitcher": { cli: "claude", model: "haiku" },
                  "style_critic":      { cli: "claude", model: "opus" },
                }}
                onStarted={refetch}
              />
            ) : (status === "writing_running" || status === "writing_failed") ? (
              <WriterProgressPanel
                projectId={projectId}
                sectionsPlanned={["opening", "closing"]}
                status={status}
              />
            ) : (status === "writing_ready" || status === "writing_editing") ? (
              <ArticleEditor projectId={projectId} />
            ) : status === "evidence_collecting" ? (
              selectedEvidenceCase
                ? <EvidenceIntakeForm projectId={projectId} caseId={selectedEvidenceCase} />
                : <div className="p-4 text-sm text-gray-500">← 左侧选一个 Case 开始上传 evidence</div>
            ) : rightPanel(status, projectId, refetch, events)}
          </div>
        </div>
      </div>
      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      {overrideOpen && (
        <ProjectOverridePanel
          projectId={projectId}
          onClose={() => setOverrideOpen(false)}
        />
      )}
      {projectId && <ContextChip projectId={projectId} />}
    </div>
  );
}

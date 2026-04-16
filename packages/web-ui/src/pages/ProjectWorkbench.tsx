import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { getProject } from "../api/client";
import { useProjectStream } from "../hooks/useProjectStream";
import { BriefIntakeForm } from "../components/right/BriefIntakeForm";
import { ExpertSelector } from "../components/right/ExpertSelector";
import { ProjectActivityView } from "../components/status/ProjectActivityView";
import { BriefSummaryCard } from "../components/left/BriefSummaryCard";
import { MissionCandidatesPanel } from "../components/left/MissionCandidateCard";
import { SelectedMissionView } from "../components/left/SelectedMissionView";
import { ProductOverviewCard } from "../components/left/ProductOverviewCard";
import { OverviewIntakeForm } from "../components/right/OverviewIntakeForm";
import { CaseExpertSelector } from "../components/right/CaseExpertSelector";
import { CaseListPanel } from "../components/left/CaseListPanel";
import { CaseSelectedGuide } from "../components/right/CaseSelectedGuide";
import { EvidenceSection } from "../components/evidence/EvidenceSection";
import { WriterConfigForm } from "../components/writer/WriterConfigForm";
import { WriterProgressPanel } from "../components/writer/WriterProgressPanel";
import { ArticleEditor } from "../components/writer/ArticleEditor";
import { ProjectOverridePanel } from "../components/config/ProjectOverridePanel";
import { PhaseSteps, statusBadge } from "../components/layout/PhaseSteps";

interface FailureInfo {
  agent?: string;
  cli?: string;
  model?: string;
  error?: string;
}

function findLastFailure(events: any[]): FailureInfo | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e: any = events[i];
    if (typeof e?.type === "string" && e.type.endsWith(".failed")) {
      return {
        agent: e.data?.agent ?? e.agent,
        cli: e.data?.cli ?? e.cli,
        model: e.data?.model ?? e.model,
        error: e.data?.error ?? e.error,
      };
    }
  }
  return null;
}

function FailureCard({ title, fail, onRetry }: { title: string; fail: FailureInfo | null; onRetry?: () => void }) {
  return (
    <div className="rounded border border-[var(--red)] bg-[rgba(255,107,107,0.05)] p-5 space-y-3">
      <div className="flex items-start gap-3">
        <span className="text-xl text-[var(--red)]">⚠</span>
        <div className="flex-1">
          <h3 className="font-semibold text-[var(--red)]">{title}</h3>
          {fail?.agent && (
            <p className="text-xs text-[var(--meta)] mt-1">
              {fail.agent} · {fail.cli}/{fail.model ?? "?"}
            </p>
          )}
        </div>
      </div>
      <pre className="text-xs whitespace-pre-wrap max-h-48 overflow-auto bg-[var(--log-bg)] p-3 border border-[var(--hair)] rounded text-[var(--body)]" style={{ fontFamily: "var(--font-mono)" }}>
        {fail?.error ?? "未捕获错误"}
      </pre>
      {onRetry && (
        <button type="button" onClick={onRetry} className="px-4 py-2 rounded bg-[var(--accent)] text-[var(--accent-on)] text-sm font-semibold">
          重试
        </button>
      )}
    </div>
  );
}

function PhasePanel({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <div className="rounded bg-[var(--bg-2)] p-5">
      {label && <div className="text-sm font-semibold text-[var(--heading)] mb-3">{label}</div>}
      {children}
    </div>
  );
}

function RunningView({ label, desc, children }: { label: string; desc?: string; children?: React.ReactNode }) {
  return (
    <div className="rounded bg-[var(--bg-2)] p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-[var(--heading)] font-semibold flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
            {label}
          </div>
          {desc && <div className="text-xs text-[var(--meta)] mt-1">{desc}</div>}
        </div>
      </div>
      <div className="space-y-2">
        {[80, 60, 90, 50].map((w, i) => (
          <span key={i} className="block h-3 rounded bg-[var(--bg-1)] overflow-hidden">
            <span className="block h-full bg-[var(--accent-fill)] animate-pulse" style={{ width: `${w}%`, animationDelay: `${i * 0.12}s` }} />
          </span>
        ))}
      </div>
      {children}
    </div>
  );
}

function BriefReadyView({ projectId, project, refetch }: { projectId: string; project: any; refetch: () => void }) {
  const [editing, setEditing] = useState(false);
  const [initialText, setInitialText] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const openEditor = async () => {
    setLoadErr(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/brief/markdown`);
      if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => "")}`);
      setInitialText(await res.text());
      setEditing(true);
    } catch (e: any) {
      setLoadErr(String(e?.message ?? e));
    }
  };

  // Editing mode: hide expert-selection panel since the brief is being rewritten
  if (editing && initialText !== null) {
    return (
      <PhasePanel label="重新上传简报">
        <BriefIntakeForm
          projectId={projectId}
          initialText={initialText}
          submitLabel="保存并重新解析 →"
          onCancel={() => setEditing(false)}
          onUploaded={() => { setEditing(false); refetch(); }}
        />
      </PhasePanel>
    );
  }

  return (
    <div className="space-y-4">
      <PhasePanel label="brief.md">
        <BriefSummaryCard projectId={projectId} />
        {loadErr && (
          <div className="mt-2 text-xs text-[var(--red)]">读取 brief 失败：{loadErr}</div>
        )}
        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            data-testid="brief-edit-button"
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded border border-[var(--accent-soft)] bg-[var(--accent-fill)] text-sm text-[var(--accent)] hover:bg-[var(--accent)] hover:text-[var(--accent-on)] transition-colors"
            onClick={() => { void openEditor(); }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            重新上传
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded border border-[var(--hair)] bg-[var(--bg-1)] text-sm text-[var(--body)] hover:border-[var(--hair-strong)] hover:bg-[var(--bg-2)] transition-colors"
            onClick={async () => {
              const res = await fetch(`/api/projects/${projectId}/brief/reanalyze`, { method: "POST" });
              if (res.ok) refetch();
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M23 4v6h-6" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            重新解析
          </button>
        </div>
      </PhasePanel>
      <PhasePanel label="挑一位选题专家 →">
        <ExpertSelector projectId={projectId} onStarted={refetch} />
      </PhasePanel>
    </div>
  );
}

interface PhaseViewProps {
  project: any;
  projectId: string;
  events: any[];
  refetch: () => void;
  selectedEvidenceCase: string | null;
  setSelectedEvidenceCase: (s: string | null) => void;
  missingBindings: Array<{ agentKey: string; reason?: string }>;
}

function renderPhaseView(props: PhaseViewProps): React.ReactNode {
  const { project, projectId, events, refetch, selectedEvidenceCase, setSelectedEvidenceCase } = props;
  const status = project.status;

  switch (status) {
    case "created":
      return <BriefIntakeForm projectId={projectId} onUploaded={refetch} />;

    case "brief_uploaded":
    case "brief_analyzing":
      return <RunningView label="正在解析简报" desc="Brief Analyst 在抽取产品名 / 调性 / 卖点…" />;

    case "brief_ready":
      return <BriefReadyView projectId={projectId} project={project} refetch={refetch} />;

    case "awaiting_expert_selection":
      return <PhasePanel label="挑一位选题专家"><ExpertSelector projectId={projectId} onStarted={refetch} /></PhasePanel>;

    case "round1_running":
    case "synthesizing":
    case "round2_running":
      return (
        <RunningView
          label={status === "synthesizing" ? "Coordinator 综合中…" : status === "round2_running" ? "第二轮收敛中…" : "第一轮思考中…"}
          desc="下方时间线可展开看实时 log"
        />
      );

    case "round1_failed":
    case "round2_failed":
      return (
        <FailureCard
          title="专家团运行失败"
          fail={findLastFailure(events)}
          onRetry={async () => { await fetch(`/api/projects/${projectId}/mission/retry`, { method: "POST" }); refetch(); }}
        />
      );

    case "awaiting_mission_pick":
      return <PhasePanel label="挑一条选题"><MissionCandidatesPanel projectId={projectId} onSelected={refetch} /></PhasePanel>;

    case "mission_approved":
      return (
        <div className="space-y-4">
          {project.mission?.selected_path && (
            <PhasePanel label="已选定选题">
              <SelectedMissionView projectId={projectId} selectedPath={project.mission.selected_path} />
            </PhasePanel>
          )}
          <PhasePanel label="下一步：补充产品资料 →">
            <OverviewIntakeForm projectId={projectId} />
          </PhasePanel>
        </div>
      );

    case "awaiting_overview_input":
      return <PhasePanel label="补充产品资料"><OverviewIntakeForm projectId={projectId} /></PhasePanel>;

    case "overview_analyzing":
      return <RunningView label="正在生成产品概览" desc="Overview Analyst 在抓取并归纳…" />;

    case "overview_failed":
      return (
        <div className="space-y-4">
          <FailureCard
            title="产品概览生成失败"
            fail={findLastFailure(events)}
            onRetry={async () => {
              const { generateOverview } = await import("../api/client");
              try { await generateOverview(projectId, { productUrls: [], userDescription: "" }); refetch(); } catch {}
            }}
          />
          <PhasePanel label="或调整后重新提交"><OverviewIntakeForm projectId={projectId} /></PhasePanel>
        </div>
      );

    case "overview_ready":
      return (
        <div className="space-y-4">
          <PhasePanel label="产品概览"><ProductOverviewCard projectId={projectId} status={status} /></PhasePanel>
          <PhasePanel label="补充材料（可选）"><OverviewIntakeForm projectId={projectId} /></PhasePanel>
        </div>
      );

    case "awaiting_case_expert_selection":
      return <PhasePanel label="挑一位 Case 专家"><CaseExpertSelector projectId={projectId} /></PhasePanel>;

    case "case_planning_running":
    case "case_synthesizing":
      return <RunningView label={status === "case_synthesizing" ? "Case 综合中…" : "Case 规划中…"} />;

    case "case_planning_failed":
      return (
        <div className="space-y-4">
          <FailureCard title="Case 规划失败" fail={findLastFailure(events)} />
          <PhasePanel label="换一位专家重试"><CaseExpertSelector projectId={projectId} /></PhasePanel>
        </div>
      );

    case "awaiting_case_selection":
      return <PhasePanel label="挑选要带入正文的 Case"><CaseListPanel projectId={projectId} /></PhasePanel>;

    case "case_plan_approved":
      return <PhasePanel label="Case 已批准，去跑真实测"><CaseSelectedGuide projectId={projectId} selectedCaseId={selectedEvidenceCase} onSelectCase={setSelectedEvidenceCase} /></PhasePanel>;

    case "evidence_collecting":
    case "evidence_ready":
      return (
        <PhasePanel label={status === "evidence_ready" ? "实测素材已齐备" : "制作 Case · 上传素材"}>
          <EvidenceSection
            projectId={projectId}
            selectedCaseId={selectedEvidenceCase}
            onSelectCase={setSelectedEvidenceCase}
          />
        </PhasePanel>
      );

    case "writing_configuring":
      return (
        <PhasePanel label="写作配置">
          <WriterConfigForm
            projectId={projectId}
            defaults={{
              "writer.opening": { cli: "claude", model: "opus" },
              "writer.practice": { cli: "claude", model: "sonnet" },
              "writer.closing": { cli: "claude", model: "opus" },
              "practice.stitcher": { cli: "claude", model: "haiku" },
              "style_critic": { cli: "claude", model: "opus" },
            }}
            onStarted={refetch}
          />
        </PhasePanel>
      );

    case "writing_running":
      return (
        <PhasePanel label="Writer 正在生成">
          <WriterProgressPanel projectId={projectId} sectionsPlanned={["opening", "closing"]} status={status} />
        </PhasePanel>
      );

    case "writing_ready":
    case "writing_editing":
      return <ArticleEditor projectId={projectId} />;

    case "writing_failed":
      return <FailureCard title="写作失败" fail={findLastFailure(events)} onRetry={refetch} />;

    default:
      return <div className="text-[var(--meta)]">未知状态: {status}</div>;
  }
}

// Pixel-style monitor icon used on the floating 控制台 entry
function ConsolePixelIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 16 16"
      fill="currentColor"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {/* outer monitor frame (top/bottom/sides) */}
      <rect x="1" y="2" width="14" height="1" />
      <rect x="1" y="9" width="14" height="1" />
      <rect x="1" y="3" width="1" height="6" />
      <rect x="14" y="3" width="1" height="6" />
      {/* screen glow (2 scan lines) */}
      <rect x="3" y="4" width="10" height="1" opacity="0.7" />
      <rect x="3" y="6" width="7" height="1" opacity="0.7" />
      {/* stand */}
      <rect x="7" y="10" width="2" height="2" />
      {/* base */}
      <rect x="4" y="12" width="8" height="1" />
    </svg>
  );
}

function ConsoleFab({ projectId, events, connectionState, lastEventTs }: { projectId: string; events: any[]; connectionState: any; lastEventTs: any }) {
  const [open, setOpen] = useState(false);
  const active = connectionState === "connected" || connectionState === "connecting";
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="console-fab"
        className="fixed bottom-5 right-5 z-40 group inline-flex items-center gap-2 h-10 pl-2.5 pr-4 rounded-full border border-[var(--hair)] bg-[var(--bg-1)] text-[var(--body)] shadow-[0_4px_12px_rgba(0,0,0,0.12)] hover:border-[var(--accent-soft)] hover:bg-[var(--bg-2)] hover:text-[var(--accent)] transition-colors"
        title={`控制台 · ${events.length} 事件`}
      >
        <span className="relative inline-flex items-center justify-center w-6 h-6 text-[var(--meta)] group-hover:text-[var(--accent)] transition-colors">
          <ConsolePixelIcon />
          {active && events.length > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
          )}
        </span>
        <span className="text-sm font-semibold tracking-wide" style={{ fontFamily: "var(--font-pixel, var(--font-mono))" }}>控制台</span>
        {events.length > 0 && (
          <span className="text-[10px] text-[var(--meta)] font-mono-term">{events.length}</span>
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="控制台"
          className="fixed inset-0 z-50 flex flex-col bg-[var(--bg-0)]"
        >
          <ProjectActivityView
            projectId={projectId}
            events={events}
            connectionState={connectionState}
            lastEventTs={lastEventTs}
            onClose={() => setOpen(false)}
          />
        </div>
      )}
    </>
  );
}

export function ProjectWorkbench({ projectId: propProjectId }: { projectId?: string } = {}) {
  const params = useParams<{ id: string }>();
  const projectId = propProjectId ?? params.id ?? "";

  const [project, setProject] = useState<any>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [selectedEvidenceCase, setSelectedEvidenceCase] = useState<string | null>(null);
  const { events, connectionState, lastEventTs } = useProjectStream(projectId);

  function refetch() {
    getProject(projectId).then(setProject).catch(() => {});
  }

  useEffect(() => {
    if (!projectId) return;
    refetch();
    const id = setInterval(refetch, 2000);
    return () => clearInterval(id);
  }, [projectId]);

  const [toast, setToast] = useState<string | null>(null);
  const lastStatusRef = useRef<string | null>(null);
  useEffect(() => {
    const latest = events[events.length - 1] as any;
    if (!latest) return;
    if (latest.type === "state_changed") {
      refetch();
      const toStatus: string | undefined = latest.data?.to;
      const TRANSITION_TOASTS: Record<string, string> = {
        brief_ready: "简报解析完成",
        awaiting_mission_pick: "候选选题已就绪",
        mission_approved: "选题已选定",
        overview_ready: "产品概览已生成",
        awaiting_case_expert_selection: "请挑 Case 专家",
        case_plan_approved: "Case 计划已批准",
        evidence_ready: "实测素材已齐",
        writing_ready: "初稿就绪",
      };
      if (toStatus && TRANSITION_TOASTS[toStatus] && lastStatusRef.current !== toStatus) {
        lastStatusRef.current = toStatus;
        setToast(TRANSITION_TOASTS[toStatus]!);
        setTimeout(() => setToast((t) => (t === TRANSITION_TOASTS[toStatus] ? null : t)), 4000);
      }
    } else if (typeof latest.type === "string" && latest.type.endsWith(".failed")) {
      refetch();
    }
  }, [events.length]);

  if (!project) return <div className="p-12 text-center text-[var(--meta)]">加载中...</div>;
  const status = project.status;
  const tone = statusBadge(status);

  let missingBindings: Array<{ agentKey: string; reason?: string }> = [];
  for (let i = events.length - 1; i >= 0; i--) {
    const e: any = events[i];
    if (e?.type === "run.blocked") {
      const mb = e.missingBindings ?? e.data?.missingBindings ?? [];
      if (Array.isArray(mb)) missingBindings = mb;
      break;
    }
    if (e?.type === "writer.section_started") break;
  }

  return (
    <div
      data-testid="page-project-workbench"
      className="rounded border border-[var(--hair)] bg-[var(--bg-1)] overflow-hidden"
    >
      {toast && (
        <div
          role="status"
          data-testid="state-toast"
          className="fixed top-16 right-4 z-50 px-4 py-2 rounded border bg-[var(--bg-1)] border-[var(--accent)] text-[var(--body)] shadow-lg text-sm"
        >
          {toast}
          <button className="ml-3 text-[var(--meta)] hover:text-[var(--body)]" onClick={() => setToast(null)}>✕</button>
        </div>
      )}

      <header
        data-testid="pw-sidebar-header"
        className="px-6 h-12 border-b bg-[var(--bg-1)] flex items-center gap-3 border-[var(--hair)]"
      >
        {!propProjectId && (
          <Link to="/" className="text-sm text-[var(--meta)] hover:text-[var(--accent)] no-underline">
            ←
          </Link>
        )}
        <h1 className="text-base font-semibold text-[var(--heading)] m-0 truncate">{project.name}</h1>
        <span
          className="text-[11px] px-2 py-0.5 rounded-sm font-medium whitespace-nowrap"
          style={{ color: tone.fg, background: tone.bg }}
        >
          {tone.label}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setOverrideOpen(true)}
          className="w-7 h-7 flex items-center justify-center rounded text-[var(--meta)] hover:text-[var(--heading)] hover:bg-[var(--bg-2)]"
          title="本项目配置（覆盖 agent 模型 / 风格 / 工具）"
          aria-label="本项目配置"
        >
          ⚙
        </button>
      </header>

      <div className="px-6 pt-4 pb-3">
        <PhaseSteps status={status} />
      </div>

      <main className="px-6 py-5">
        {missingBindings.length > 0 && (
          <div className="mb-4 border rounded p-4 border-[var(--red)] bg-[var(--bg-2)]">
            <h3 className="font-semibold mb-2 text-[var(--red)]">⚠ 无法开始</h3>
            <div className="text-sm mb-2 text-[var(--body)]">下列 agent 未绑定风格：</div>
            <ul className="text-xs ml-4 mb-3 text-[var(--body)]" style={{ fontFamily: "var(--font-mono)" }}>
              {missingBindings.map((mb, i) => (
                <li key={`${mb.agentKey}-${i}`}>• {mb.agentKey}{mb.reason ? ` (${mb.reason})` : ""}</li>
              ))}
            </ul>
            <div className="flex gap-2">
              <button type="button" onClick={() => setOverrideOpen(true)} className="px-3 py-1.5 text-xs rounded border border-[var(--hair-strong)] text-[var(--meta)] hover:text-[var(--heading)]">
                本项目专属配置
              </button>
              <Link to="/config" className="text-xs px-3 py-1.5 border border-[var(--hair-strong)] rounded no-underline text-[var(--meta)] hover:text-[var(--accent)]">
                去配置工作台
              </Link>
            </div>
          </div>
        )}
        {renderPhaseView({ project, projectId, events, refetch, selectedEvidenceCase, setSelectedEvidenceCase, missingBindings })}
      </main>

      <ConsoleFab projectId={projectId} events={events} connectionState={connectionState} lastEventTs={lastEventTs} />

      {overrideOpen && (
        <ProjectOverridePanel projectId={projectId} onClose={() => setOverrideOpen(false)} />
      )}
    </div>
  );
}

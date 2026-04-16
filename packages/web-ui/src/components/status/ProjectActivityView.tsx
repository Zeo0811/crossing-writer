import { useEffect, useMemo, useState } from "react";
import type { ConnectionState, StreamEvent } from "../../hooks/useProjectStream";
import { SseHealthDot } from "./SseHealthDot";
import { formatBeijingTime } from "../../utils/time";
import {
  deriveAgentPipeline,
  eventLabel,
  formatElapsed,
  type Phase,
  type PhaseStatus,
} from "./agentPipeline";

interface TreeNode {
  name: string;
  type: "dir" | "file";
  path: string;
  children?: TreeNode[];
  size?: number;
  mtime?: string;
}

// Classify an event into a terminal-log source tag.
// Sources: `writer`, `[TOOL]`, `state`, `agent`, `expert`, `coord`, `evidence`, `fallback to the event type prefix`.
function logSource(ev: StreamEvent): { label: string; tone: "plain" | "tool" | "state" | "error" } {
  const t = ev.type;
  if (t === "agent.tool_called" || t === "agent.tool_returned") return { label: "[TOOL]", tone: "tool" };
  if (t.startsWith("writer.tool_")) return { label: "[TOOL]", tone: "tool" };
  if (t === "state_changed") return { label: "state", tone: "state" };
  if (t.endsWith(".failed")) {
    const a = (ev.agent ?? (ev.data as any)?.agent ?? "agent").toString().split(".")[0]!;
    return { label: a, tone: "error" };
  }
  if (t.startsWith("writer.")) return { label: "writer", tone: "plain" };
  if (t.startsWith("expert.")) return { label: "expert", tone: "plain" };
  if (t.startsWith("coordinator.")) return { label: "coord", tone: "plain" };
  if (t.startsWith("case_expert.")) return { label: "case-expert", tone: "plain" };
  if (t.startsWith("case_coordinator.")) return { label: "case-coord", tone: "plain" };
  if (t.startsWith("evidence.")) return { label: "evidence", tone: "plain" };
  if (t.startsWith("overview.")) return { label: "overview", tone: "plain" };
  if (t.startsWith("agent.")) return { label: ev.agent ?? "agent", tone: "plain" };
  return { label: t.split(".")[0] ?? t, tone: "plain" };
}

function describeToolEvent(ev: StreamEvent): string {
  const d = (ev.data ?? ev.payload ?? {}) as any;
  if (ev.type === "agent.tool_called") {
    const tool = d.toolName ?? "?";
    let inputStr = "";
    try { inputStr = JSON.stringify(d.input ?? {}); } catch { inputStr = "…"; }
    if (inputStr.length > 180) inputStr = inputStr.slice(0, 180) + "…";
    return `→ ${tool}(${inputStr})`;
  }
  if (ev.type === "agent.tool_returned") {
    const prefix = d.isError ? "✗" : "←";
    const preview = typeof d.preview === "string" ? d.preview.replace(/\s+/g, " ").slice(0, 140) : "";
    return `${prefix} ${preview}${preview.length >= 140 ? "…" : ""}`;
  }
  return ev.type;
}

function toneClass(tone: "plain" | "tool" | "state" | "error"): string {
  switch (tone) {
    case "tool": return "text-[var(--amber)]";
    case "state": return "text-[var(--meta)]";
    case "error": return "text-[var(--red)]";
    default: return "text-[var(--accent)]";
  }
}

function phaseChipClass(status: PhaseStatus, active: boolean): string {
  if (active) return "bg-[var(--accent)] text-[var(--accent-on)] border-[var(--accent)]";
  switch (status) {
    case "done": return "bg-[var(--bg-2)] text-[var(--body)] border-[var(--hair)]";
    case "running": return "bg-[var(--accent-fill)] text-[var(--accent)] border-[var(--accent-soft)]";
    case "failed": return "bg-[rgba(255,107,107,0.08)] text-[var(--red)] border-[var(--red)]";
    default: return "bg-[var(--bg-1)] text-[var(--faint)] border-[var(--hair)]";
  }
}

function TreeItem({ node, depth }: { node: TreeNode; depth: number }) {
  const [open, setOpen] = useState(depth < 2);
  const pad = { paddingLeft: `${depth * 12}px` };
  if (node.type === "file") {
    return (
      <div
        className="flex items-center gap-1.5 px-2 py-1 text-xs text-[var(--body)] hover:bg-[var(--bg-2)] rounded truncate"
        style={pad}
        title={node.path}
      >
        <span className="text-[var(--faint)]">·</span>
        <span className="truncate">{node.name}</span>
      </div>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-1.5 px-2 py-1 text-xs text-[var(--heading)] hover:bg-[var(--bg-2)] rounded"
        style={pad}
      >
        <span className="text-[var(--faint)] w-3 text-center">{open ? "▾" : "▸"}</span>
        <span className="font-semibold truncate">{node.name}/</span>
      </button>
      {open && node.children?.map((c) => (
        <TreeItem key={c.path || c.name} node={c} depth={depth + 1} />
      ))}
    </>
  );
}

function ProjectTree({ projectId }: { projectId: string }) {
  const [root, setRoot] = useState<TreeNode | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const reload = async () => {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/tree`);
      if (!res.ok) throw new Error(`${res.status}`);
      const json = await res.json();
      setRoot(json.root);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    }
  };

  useEffect(() => {
    void reload();
    const id = setInterval(() => { void reload(); }, 5000);
    return () => clearInterval(id);
  }, [projectId]);

  return (
    <div className="text-xs font-mono-term space-y-0.5">
      <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-[var(--faint)] font-semibold">PROJECT TREE</div>
      {err && <div className="px-2 py-1 text-[var(--red)]">{err}</div>}
      {root ? <TreeItem node={root} depth={0} /> : (
        <div className="px-2 py-1 text-[var(--faint)]">加载中…</div>
      )}
    </div>
  );
}

function TerminalLog({
  events,
  projectId,
  onOpenRun,
}: {
  events: StreamEvent[];
  projectId: string;
  onOpenRun: (runDir: string, agent?: string) => void;
}) {
  // Show most recent 300 events to avoid DOM bloat
  const recent = events.slice(-300);
  return (
    <div
      className="font-mono-term text-[11px] leading-[1.7] text-[var(--body)] bg-[var(--bg-1)] border border-[var(--hair)] rounded p-3 overflow-y-auto overflow-x-hidden h-full"
      data-testid="activity-terminal-log"
    >
      {recent.length === 0 && (
        <div className="text-[var(--faint)]">等待 agent 事件…</div>
      )}
      {recent.map((ev, i) => {
        const rawTs = typeof ev.ts === "number" ? new Date(ev.ts) : ev.ts;
        const ts = formatBeijingTime(rawTs as string | Date | null | undefined);
        const src = logSource(ev);
        // Special row for agent.io_snapshot — clickable to open prompt/response drawer
        if (ev.type === "agent.io_snapshot") {
          const d = (ev.data ?? ev.payload ?? {}) as any;
          const runDir = String(d.runDir ?? "");
          const dur = typeof d.durationMs === "number" ? `${Math.round(d.durationMs / 1000)}s` : "";
          const agent = d.agent ?? ev.agent ?? "";
          return (
            <button
              key={i}
              type="button"
              onClick={() => onOpenRun(runDir, agent)}
              className="w-full flex items-start gap-2 text-left px-1 -mx-1 rounded hover:bg-[var(--bg-2)] cursor-pointer"
              data-testid={`log-row-iosnapshot-${i}`}
            >
              <span className="text-[var(--faint)] shrink-0 tabular-nums">[{ts}]</span>
              <span className="text-[var(--amber)] shrink-0 w-20 truncate">io</span>
              <span className="text-[var(--faint)] shrink-0">›</span>
              <span className="text-[var(--body)] break-all min-w-0 flex-1">
                {agent} run {dur && `· ${dur}`} <span className="text-[var(--accent)] underline underline-offset-2">查看 prompt / response</span>
              </span>
            </button>
          );
        }
        const msg =
          ev.type === "agent.tool_called" || ev.type === "agent.tool_returned"
            ? describeToolEvent(ev)
            : eventLabel(ev);
        return (
          <div key={i} className="flex items-start gap-2">
            <span className="text-[var(--faint)] shrink-0 tabular-nums">[{ts}]</span>
            <span className={`${toneClass(src.tone)} shrink-0 w-20 truncate`}>{src.label}</span>
            <span className="text-[var(--faint)] shrink-0">›</span>
            <span className="text-[var(--body)] break-all min-w-0 flex-1">{msg}</span>
          </div>
        );
      })}
    </div>
  );
}

type RunDrawerTab = "prompt" | "response" | "meta" | "stderr" | "trace";
function RunDrawer({
  projectId,
  runDir,
  agent,
  onClose,
}: {
  projectId: string;
  runDir: string;
  agent?: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<RunDrawerTab>("prompt");
  const [content, setContent] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // runDir is like "runs/2026-04-16T08-00-22-530Z-brief_analyst"
  const runId = runDir.replace(/^runs\//, "");

  useEffect(() => {
    let cancelled = false;
    const fileName =
      tab === "prompt" ? "prompt.txt" :
      tab === "response" ? "response.txt" :
      tab === "stderr" ? "stderr.txt" :
      tab === "trace" ? "trace.ndjson" :
      "meta.json";
    setLoading(true);
    setErr(null);
    setContent("");
    fetch(`/api/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}/${fileName}`)
      .then(async (r) => {
        if (!r.ok) {
          if (r.status === 404) return "(空)";
          throw new Error(`${r.status}`);
        }
        return r.text();
      })
      .then((t) => { if (!cancelled) setContent(t); })
      .catch((e: any) => { if (!cancelled) setErr(String(e?.message ?? e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, runId, tab]);

  const tabs: Array<{ key: RunDrawerTab; label: string }> = [
    { key: "prompt", label: "Prompt" },
    { key: "response", label: "Response" },
    { key: "meta", label: "Meta" },
    { key: "trace", label: "Trace" },
    { key: "stderr", label: "Stderr" },
  ];

  return (
    <div
      role="dialog"
      aria-label="运行详情"
      className="fixed inset-0 z-[60] flex items-stretch justify-end bg-[rgba(0,0,0,0.45)] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="h-full w-[720px] max-w-[95vw] flex flex-col bg-[var(--bg-0)] border-l border-[var(--hair)] shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 px-5 py-3 border-b border-[var(--hair)] bg-[var(--bg-1)]">
          <div>
            <div className="text-sm font-semibold text-[var(--heading)]">{agent ?? "Agent"} · 运行详情</div>
            <div className="text-[10px] text-[var(--faint)] font-mono-term mt-0.5 truncate max-w-[520px]" title={runDir}>{runDir}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded text-[var(--meta)] hover:text-[var(--heading)] hover:bg-[var(--bg-2)]"
            aria-label="关闭"
          >✕</button>
        </header>
        <div className="flex items-center gap-1 px-4 border-b border-[var(--hair)] bg-[var(--bg-1)]">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-2 text-xs border-b-2 -mb-px transition-colors ${
                tab === t.key ? "border-[var(--accent)] text-[var(--heading)] font-semibold" : "border-transparent text-[var(--meta)] hover:text-[var(--heading)]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex-1 min-h-0 overflow-auto p-4 bg-[var(--bg-0)]">
          {loading && <div className="text-xs text-[var(--faint)]">加载中…</div>}
          {err && <div className="text-xs text-[var(--red)]">读取失败：{err}</div>}
          {!loading && !err && (
            <pre className="font-mono-term text-[11px] leading-[1.7] text-[var(--body)] whitespace-pre-wrap break-words">
              {content || "(空)"}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

function StepPills({ phases, currentPhase }: { phases: Phase[]; currentPhase: Phase["key"] | null }) {
  return (
    <ol className="flex items-center gap-1.5 flex-wrap">
      {phases.map((p, i) => (
        <li key={p.key}>
          <span
            className={`inline-flex items-center gap-1.5 h-7 px-3 text-[11px] font-mono-term rounded-full border ${phaseChipClass(p.status, p.key === currentPhase)}`}
            title={`${p.label}: ${p.status}`}
          >
            <span className="text-[10px] opacity-70">{String(i + 1).padStart(2, "0")}</span>
            <span>{p.label}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

export function ProjectActivityView({
  projectId,
  events,
  connectionState,
  lastEventTs,
  onClose,
}: {
  projectId: string;
  events: StreamEvent[];
  connectionState?: ConnectionState;
  lastEventTs?: number | null;
  onClose: () => void;
}) {
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [runDrawer, setRunDrawer] = useState<{ runDir: string; agent?: string } | null>(null);
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const { phases, currentActivity } = useMemo(() => deriveAgentPipeline(events), [events]);

  const currentPhaseKey = useMemo(() => {
    const running = phases.find((p) => p.status === "running");
    if (running) return running.key;
    // Otherwise point at the last done phase
    const doneIdx = phases.map((p) => p.status).lastIndexOf("done");
    return doneIdx >= 0 ? phases[doneIdx]!.key : null;
  }, [phases]);

  const streaming =
    connectionState === "connected" || connectionState === "connecting" ||
    currentActivity?.status === "running";

  const elapsed = currentActivity
    ? formatElapsed(currentActivity.startedAt, nowTick)
    : "—";

  const openFolder = async () => {
    try {
      await fetch(`/api/projects/${encodeURIComponent(projectId)}/open-folder`, { method: "POST" });
    } catch { /* ignore */ }
  };

  const stopRun = async () => {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/agent/stop`, { method: "POST" });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        alert(`停止失败：${t}`);
      }
    } catch (e: any) {
      alert(`停止失败：${e?.message ?? e}`);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[var(--bg-0)]">
      {/* Header */}
      <header className="flex items-start justify-between gap-4 px-6 py-4 border-b border-[var(--hair)] bg-[var(--bg-1)]">
        <div>
          <h2 className="text-base font-semibold text-[var(--heading)] flex items-center gap-2">
            <span>Project · {projectId}</span>
            {connectionState && (
              <SseHealthDot connectionState={connectionState} lastEventTs={lastEventTs ?? null} />
            )}
          </h2>
          <p className="text-xs text-[var(--meta)] mt-1">
            左侧为项目树，右侧为执行日志。
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => { void openFolder(); }}
            className="inline-flex items-center h-8 px-3 rounded border border-[var(--hair)] bg-[var(--bg-1)] text-xs text-[var(--body)] hover:bg-[var(--bg-2)]"
          >
            Open folder
          </button>
          <button
            type="button"
            onClick={() => { void stopRun(); }}
            className="inline-flex items-center h-8 px-3 rounded border border-[var(--hair)] bg-[var(--bg-1)] text-xs text-[var(--body)] hover:border-[var(--red)] hover:text-[var(--red)]"
          >
            Stop run
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center h-8 w-8 justify-center rounded text-[var(--meta)] hover:text-[var(--heading)] hover:bg-[var(--bg-2)]"
            aria-label="收起"
            title="收起"
          >
            ✕
          </button>
        </div>
      </header>

      {/* Body: 2-col */}
      <div className="flex-1 min-h-0 grid grid-cols-[260px_1fr] gap-0">
        <aside className="border-r border-[var(--hair)] overflow-y-auto bg-[var(--bg-1)] py-2">
          <ProjectTree projectId={projectId} />
        </aside>

        <main className="flex flex-col min-h-0 min-w-0 p-4 gap-3">
          {/* Run header: agent name + streaming badge */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-[var(--heading)] font-semibold truncate">
              <span>{currentActivity ? `Run · ${currentActivity.agent}` : "暂无活跃 agent"}</span>
              {currentActivity?.round != null && (
                <span className="text-[var(--meta)] text-xs font-normal">R{currentActivity.round}</span>
              )}
              {currentActivity?.cli && (
                <span className="text-[var(--meta)] text-xs font-normal">· {currentActivity.cli}{currentActivity.model ? ` (${currentActivity.model})` : ""}</span>
              )}
            </div>
            <div className="shrink-0">
              <span className={`inline-flex items-center gap-1.5 h-6 px-2 rounded-full text-[10px] border ${streaming ? "bg-[var(--accent-fill)] text-[var(--accent)] border-[var(--accent-soft)]" : "bg-[var(--bg-2)] text-[var(--meta)] border-[var(--hair)]"}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${streaming ? "bg-[var(--accent)] animate-pulse" : "bg-[var(--hair-strong)]"}`} />
                {streaming ? "streaming" : "idle"}
              </span>
            </div>
          </div>

          {/* Pills */}
          <StepPills phases={phases} currentPhase={currentPhaseKey} />

          {/* Terminal log */}
          <div className="flex-1 min-h-0">
            <TerminalLog
              events={events}
              projectId={projectId}
              onOpenRun={(runDir, agent) => setRunDrawer({ runDir, agent })}
            />
          </div>

          {/* Footer */}
          <footer className="flex items-center justify-between text-[11px] font-mono-term text-[var(--meta)]">
            <div className="flex items-center gap-3">
              <span>ROUND {currentActivity?.round ?? "—"}</span>
              <span>·</span>
              <span>{events.length} EVENTS</span>
              <span>·</span>
              <span>{elapsed} ELAPSED</span>
            </div>
            <div className="flex items-center gap-2">
              {/* Accept & Save / Diff — placeholders, only wired when writer drafts are pending.
                  Left unwired for now; show disabled so layout matches the reference. */}
              <button
                type="button"
                disabled
                className="inline-flex items-center h-8 px-3 rounded border border-[var(--hair)] bg-[var(--bg-1)] text-xs text-[var(--faint)] cursor-not-allowed"
              >
                Diff
              </button>
              <button
                type="button"
                disabled
                className="inline-flex items-center h-8 px-3 rounded border border-[var(--accent-soft)] bg-[var(--accent-fill)] text-xs text-[var(--accent)] opacity-60 cursor-not-allowed"
              >
                Accept &amp; Save
              </button>
            </div>
          </footer>
        </main>
      </div>

      {runDrawer && (
        <RunDrawer
          projectId={projectId}
          runDir={runDrawer.runDir}
          agent={runDrawer.agent}
          onClose={() => setRunDrawer(null)}
        />
      )}
    </div>
  );
}

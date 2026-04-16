import { useEffect, useRef, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { useWriterSections } from "../../hooks/useWriterSections";
import { useProjectStream } from "../../hooks/useProjectStream";
import { useTextSelection } from "../../hooks/useTextSelection";
import {
  getAgentConfigs,
  getFinal,
  getProjectOverride,
  listConfigStylePanels,
  putSection,
  rewriteSectionStream,
  type AgentConfigEntry,
  type StylePanel,
  type ToolUsageFrontmatter,
} from "../../api/writer-client";
import { mergeAllAgentConfigs } from "../../utils/merge-agent-config";
import { SelectionBubble } from "./SelectionBubble";
import { InlineComposer, type AnchorRect } from "./InlineComposer";
import { ArticleSectionEditor } from "./ArticleSectionEditor";

interface EditHistoryEntry { at: string; kind: string; summary?: string }

function EditHistoryExpander({ history }: { history?: EditHistoryEntry[] }) {
  if (!history || history.length === 0) return null;
  const last = history[history.length - 1]!;
  return (
    <details data-testid="edit-history-expander" className="mt-2 text-xs text-[var(--meta)]">
      <summary>📝 人工编辑 {history.length} 次 (最近: {last.at})</summary>
      <ul className="mt-1 list-disc ml-5">
        {history.map((h, i) => (
          <li key={i} className="font-mono">
            {h.at} — {h.kind}{h.summary ? ` — ${h.summary}` : ""}
          </li>
        ))}
      </ul>
    </details>
  );
}

function ReferencePanel({
  toolsUsed,
}: {
  toolsUsed: ToolUsageFrontmatter[];
}) {
  const [open, setOpen] = useState(false);
  const total = toolsUsed?.length ?? 0;

  return (
    <div className="mt-2 border-t pt-2 text-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-slate-500 hover:text-[var(--body)]"
      >
        {open ? "▼" : "▶"} 📚 本段引用 ({total})
      </button>
      {open && (
        <div className="mt-2 space-y-1">
          {total === 0 && <div className="text-slate-400">暂无引用</div>}
          {toolsUsed?.map((u, i) => {
            const name = u.toolName ?? u.tool;
            const okLabel = u.ok === false ? "fail" : "ok";
            const summary = u.summary ?? (typeof u.hits_count === "number" ? `hits: ${u.hits_count}` : okLabel);
            return (
              <div key={`tu-${i}`} className="text-slate-700">
                <span className="font-mono text-xs">[{name}·r{u.round}]</span> {summary}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export interface ArticleSectionProps {
  projectId: string;
  status: string;
}

interface MarkerRange { key: string; headerStart: number; bodyStart: number; bodyEnd: number }

function parseMarkers(content: string): MarkerRange[] {
  const re = /<!--\s*section:([^\s]+)\s*-->/g;
  const raw: Array<{ key: string; start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) raw.push({ key: m[1]!, start: m.index, end: re.lastIndex });
  const out: MarkerRange[] = [];
  for (let i = 0; i < raw.length; i++) {
    const next = i < raw.length - 1 ? raw[i + 1]!.start : content.length;
    out.push({ key: raw[i]!.key, headerStart: raw[i]!.start, bodyStart: raw[i]!.end, bodyEnd: next });
  }
  return out;
}

function extractBodies(full: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of parseMarkers(full)) {
    out[r.key] = full.slice(r.bodyStart, r.bodyEnd).trim();
  }
  return out;
}

const TITLE: Record<string, string> = {
  opening: "📝 开头",
  closing: "📝 结尾",
};

function sectionAgentKey(key: string): string | null {
  if (key === "opening") return "writer.opening";
  if (key === "closing") return "writer.closing";
  if (key.startsWith("practice.case-")) return "writer.practice";
  return null;
}

function StyleBadge({
  sectionKey,
  effective,
  panels,
}: {
  sectionKey: string;
  effective: Record<string, AgentConfigEntry>;
  panels: StylePanel[];
}) {
  const agentKey = sectionAgentKey(sectionKey);
  if (!agentKey) return null;
  const cfg = effective[agentKey];
  const binding = cfg?.styleBinding;
  if (!binding) {
    return (
      <span
        data-testid={`style-badge-${sectionKey}`}
        className="text-xs ml-2"
        style={{ color: "var(--red)" }}
      >
        ⚠️ 未绑定
      </span>
    );
  }
  const active = panels
    .filter((p) => p.account === binding.account && p.role === binding.role && p.status === "active" && !p.is_legacy)
    .sort((a, b) => b.version - a.version);
  const v = active[0]?.version;
  const text = v !== undefined
    ? `🎨 ${binding.account}/${binding.role} v${v}`
    : `⚠️ 未绑定`;
  const color = v !== undefined ? undefined : "var(--red)";
  return (
    <span
      data-testid={`style-badge-${sectionKey}`}
      className="text-xs ml-2 font-mono"
      style={color ? { color } : undefined}
    >
      {text}
    </span>
  );
}

function sectionTitle(key: string): string {
  if (TITLE[key]) return TITLE[key]!;
  if (key.startsWith("practice.case-")) return `📝 ${key.slice("practice.".length)}`;
  if (key.startsWith("transition.")) return `↪ 过渡`;
  return key;
}

export function ArticleSection({ projectId, status }: ArticleSectionProps) {
  const { sections } = useWriterSections(projectId);
  const { events } = useProjectStream(projectId);
  const [bodies, setBodies] = useState<Record<string, string>>({});
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [hint, setHint] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [selectedText, setSelectedText] = useState<string>("");
  const [selectionKey, setSelectionKey] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const selection = useTextSelection(bodyRef);
  const [selectionRewriteOpen, setSelectionRewriteOpen] = useState<{ key: string; text: string; rect: AnchorRect } | null>(null);
  const [effectiveAgents, setEffectiveAgents] = useState<Record<string, AgentConfigEntry>>({});
  const [stylePanels, setStylePanels] = useState<StylePanel[]>([]);
  const [editMode, setEditMode] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cfgs, override, panels] = await Promise.all([
          getAgentConfigs(),
          getProjectOverride(projectId).catch(() => ({ agents: {} })),
          listConfigStylePanels().catch(() => ({ panels: [] })),
        ]);
        if (cancelled) return;
        setEffectiveAgents(mergeAllAgentConfigs(cfgs.agents, override));
        setStylePanels(panels.panels);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  const reload = useCallback(async () => {
    if (status === "evidence_ready" || status === "writing_configuring" || status === "writing_running") return;
    try {
      const full = await getFinal(projectId);
      setBodies(extractBodies(full));
    } catch { /* ignore */ }
  }, [projectId, status]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    if (events.length === 0) return;
    const last = events[events.length - 1];
    if (!last) return;
    if (last.type === "writer.rewrite_completed" || last.type === "writer.final_rebuilt" || last.type === "writer.style_critic_applied") {
      reload();
    }
  }, [events, reload]);

  if (status === "evidence_ready" || status === "writing_configuring") {
    return <div className="p-3 text-sm text-[var(--meta)]">SP-04 已完成。在右栏配置写作参数并开始。</div>;
  }
  if (status === "writing_running") {
    return <div className="p-3 text-sm">{sections.length} 段完成（进行中）</div>;
  }

  const opening = sections.find((s) => s.key === "opening");
  const closing = sections.find((s) => s.key === "closing");
  const practice = sections.filter((s) => s.key.startsWith("practice.case-"));
  const refAccounts = [...new Set(sections.flatMap((s) => s.frontmatter.reference_accounts ?? []))];

  const renderOrder: string[] = [];
  if (opening) renderOrder.push("opening");
  for (const p of practice) renderOrder.push(p.key);
  if (closing) renderOrder.push("closing");

  const rewriteSupported = (key: string) => key === "opening" || key === "closing" || key.startsWith("practice.case-");

  const triggerRewrite = async (key: string, useSelection: boolean) => {
    const snippet = useSelection && selectionKey === key ? selectedText : undefined;
    setActiveKey(null);
    setBusyKey(key);
    try {
      await rewriteSectionStream(
        projectId,
        key,
        hint || undefined,
        (ev) => {
          if (ev.type === "writer.rewrite_chunk" && ev.data?.chunk) {
            setBodies((b) => ({ ...b, [key]: ev.data.chunk }));
          }
        },
        snippet,
      );
    } finally {
      setBusyKey(null);
      setHint("");
      setSelectedText("");
      setSelectionKey(null);
      reload();
    }
  };

  const handleSelectionChange = (key: string, body: string) => {
    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : "";
    if (!text || !body.includes(text)) {
      if (selectionKey === key) { setSelectedText(""); setSelectionKey(null); }
      return;
    }
    setSelectedText(text);
    setSelectionKey(key);
  };

  const openSelectionComposer = () => {
    const text = selection.text;
    if (!text) return;
    const hitKey = renderOrder.find((k) => (bodies[k] ?? "").includes(text)) ?? renderOrder[0];
    if (!hitKey) return;
    const r = selection.rect;
    const rect: AnchorRect = r
      ? { top: r.top, left: r.left, bottom: r.bottom, right: r.right }
      : { top: 0, left: 0, bottom: 0, right: 0 };
    setSelectionRewriteOpen({ key: hitKey, text, rect });
  };

  return (
    <div className="p-3 flex flex-col gap-3 text-sm">
      <div className="flex flex-col gap-0.5 border-b pb-2">
        {opening && <div>📝 开头 <span className="text-xs text-[var(--meta)]">{opening.frontmatter.last_agent}</span></div>}
        <div>📝 实测</div>
        {practice.map((p) => (
          <div key={p.key} className="ml-4">├ {p.key.slice("practice.".length)} <span className="text-xs text-[var(--meta)]">{p.frontmatter.last_agent}</span></div>
        ))}
        {closing && <div>📝 结尾 <span className="text-xs text-[var(--meta)]">{closing.frontmatter.last_agent}</span></div>}
        {refAccounts.length > 0 && <div className="text-xs text-[var(--meta)] mt-1">参考账号: {refAccounts.join(" / ")}</div>}
        <a href={`/api/projects/${projectId}/writer/final`} download="final.md" className="mt-2 px-2 py-1 bg-[var(--bg-2)] rounded text-center">导出 final.md</a>
      </div>

      <div ref={bodyRef} className="flex flex-col gap-3">
        {renderOrder.map((key) => {
          const body = bodies[key] ?? "";
          const supported = rewriteSupported(key);
          const isActive = activeKey === key;
          const isBusy = busyKey === key;
          const hasSelection = selectionKey === key && selectedText.length > 0;
          const sectionMeta = sections.find((s) => s.key === key);
          const toolsUsed = (sectionMeta?.frontmatter?.tools_used ?? []) as ToolUsageFrontmatter[];
          const isEditing = !!editMode[key];
          const sectionFm = (sectionMeta?.frontmatter ?? {}) as Record<string, any>;
          const editHistory = (sectionFm.edit_history ?? []) as EditHistoryEntry[];
          const agentRunningOnSection = isBusy;
          const handleSaveEdit = async (nextBody: string) => {
            const now = new Date().toISOString();
            const nextHistory = [...editHistory.slice(-19), { at: now, kind: "manual" }];
            await putSection(projectId, key, {
              body: nextBody,
              frontmatter: {
                manually_edited: true,
                last_edited_at: now,
                edit_history: nextHistory,
              },
            });
            setBodies((b) => ({ ...b, [key]: nextBody }));
            setEditMode((m) => ({ ...m, [key]: false }));
            reload();
          };
          return (
            <section key={key} data-testid={`article-section-card-${key}`} className="group relative border border-hair rounded-[10px] p-4 bg-bg-1 hover:border-accent transition-colors">
              <header className="flex justify-between items-center text-xs text-meta mb-2">
                <span className="font-mono-term">
                  {sectionTitle(key)}
                  <StyleBadge sectionKey={key} effective={effectiveAgents} panels={stylePanels} />
                </span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    data-testid={`edit-toggle-${key}`}
                    onClick={() => setEditMode((m) => ({ ...m, [key]: !m[key] }))}
                    disabled={!isEditing && agentRunningOnSection}
                    title={agentRunningOnSection && !isEditing ? "写作中，请稍后编辑" : undefined}
                    className="px-2 py-0.5 border rounded text-[var(--body)] hover:bg-[var(--bg-2)] disabled:opacity-50"
                  >
                    {isEditing ? "👁 预览" : "✏️ 编辑"}
                  </button>
                  {!isEditing && supported && !isBusy && hasSelection && (
                    <button
                      onClick={() => setActiveKey(isActive ? null : key)}
                      className="px-2 py-0.5 border rounded text-orange-600 hover:bg-orange-50"
                      title={`只改写：${selectedText.slice(0, 40)}${selectedText.length > 40 ? "…" : ""}`}
                    >
                      🎯 重写选中
                    </button>
                  )}
                  {!isEditing && supported && !isBusy && !hasSelection && (
                    <button
                      onClick={() => setActiveKey(isActive ? null : key)}
                      className="opacity-0 group-hover:opacity-100 transition px-2 py-0.5 border rounded text-[var(--accent)] hover:bg-[var(--accent-fill)]"
                    >
                      🤖 重写整段
                    </button>
                  )}
                </div>
                {isBusy && <span className="text-[var(--accent)]">重写中…</span>}
              </header>
              {isEditing && agentRunningOnSection && (
                <div data-testid={`agent-running-notice-${key}`} className="mb-2 text-xs bg-yellow-50 border border-yellow-200 rounded p-2 text-yellow-800">
                  agent 正在写入此段
                </div>
              )}
              {isActive && (
                <div className="mb-2 flex flex-col gap-2">
                  {hasSelection && (
                    <div className="text-xs bg-orange-50 border border-orange-200 rounded p-2">
                      <span className="text-orange-700">选中片段：</span>
                      <span className="font-mono">{selectedText.slice(0, 120)}{selectedText.length > 120 ? "…" : ""}</span>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input
                      value={hint}
                      onChange={(e) => setHint(e.target.value)}
                      placeholder="给 agent 的提示（可空）"
                      className="flex-1 px-2 py-1 border rounded text-xs"
                    />
                    <button onClick={() => triggerRewrite(key, hasSelection)} className="px-2 py-1 bg-[var(--accent)] text-white rounded text-xs">
                      {hasSelection ? "确认改片段" : "确认改整段"}
                    </button>
                    <button onClick={() => { setActiveKey(null); setHint(""); }} className="px-2 py-1 bg-[var(--bg-2)] rounded text-xs">取消</button>
                  </div>
                </div>
              )}
              {isEditing ? (
                <ArticleSectionEditor
                  initialBody={body}
                  projectId={projectId}
                  sectionKey={key}
                  onSave={handleSaveEdit}
                  onCancel={() => setEditMode((m) => ({ ...m, [key]: false }))}
                />
              ) : (
                <article
                  className="prose prose-sm max-w-none"
                  data-testid={`section-render-${key}`}
                  onMouseUp={() => handleSelectionChange(key, body)}
                  onKeyUp={() => handleSelectionChange(key, body)}
                >
                  <ReactMarkdown>{body || "_(空)_"}</ReactMarkdown>
                </article>
              )}
              <EditHistoryExpander history={editHistory} />
              <ReferencePanel toolsUsed={toolsUsed} />
              {selectionRewriteOpen?.key === key && (
                <InlineComposer
                  projectId={projectId}
                  sectionKey={key}
                  selectedText={selectionRewriteOpen.text}
                  anchorRect={selectionRewriteOpen.rect}
                  onCancel={() => setSelectionRewriteOpen(null)}
                  onCompleted={() => {
                    setSelectionRewriteOpen(null);
                    reload();
                  }}
                />
              )}
            </section>
          );
        })}
      </div>
      {!selectionRewriteOpen && (
        <SelectionBubble
          rect={selection.isActive ? selection.rect : null}
          onClick={openSelectionComposer}
        />
      )}
    </div>
  );
}

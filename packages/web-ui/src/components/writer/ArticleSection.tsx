import { useEffect, useRef, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { useWriterSections } from "../../hooks/useWriterSections";
import { useProjectStream } from "../../hooks/useProjectStream";
import { useTextSelection } from "../../hooks/useTextSelection";
import {
  getFinal,
  rewriteSectionStream,
  type ToolUsageFrontmatter,
} from "../../api/writer-client";
import { SelectionBubble } from "./SelectionBubble";
import { InlineComposer } from "./InlineComposer";

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
        className="text-slate-500 hover:text-slate-800"
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
  const [selectionRewriteOpen, setSelectionRewriteOpen] = useState<{ key: string; text: string } | null>(null);

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
    return <div className="p-3 text-sm text-gray-600">SP-04 已完成。在右栏配置写作参数并开始。</div>;
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
    setSelectionRewriteOpen({ key: hitKey, text });
  };

  return (
    <div className="p-3 flex flex-col gap-3 text-sm">
      <div className="flex flex-col gap-0.5 border-b pb-2">
        {opening && <div>📝 开头 <span className="text-xs text-gray-500">{opening.frontmatter.last_agent}</span></div>}
        <div>📝 实测</div>
        {practice.map((p) => (
          <div key={p.key} className="ml-4">├ {p.key.slice("practice.".length)} <span className="text-xs text-gray-500">{p.frontmatter.last_agent}</span></div>
        ))}
        {closing && <div>📝 结尾 <span className="text-xs text-gray-500">{closing.frontmatter.last_agent}</span></div>}
        {refAccounts.length > 0 && <div className="text-xs text-gray-500 mt-1">参考账号: {refAccounts.join(" / ")}</div>}
        <a href={`/api/projects/${projectId}/writer/final`} download="final.md" className="mt-2 px-2 py-1 bg-gray-200 rounded text-center">导出 final.md</a>
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
          return (
            <section key={key} className="group relative border rounded p-3 bg-white hover:border-blue-400">
              <header className="flex justify-between items-center text-xs text-gray-500 mb-2">
                <span className="font-mono">{sectionTitle(key)}</span>
                <div className="flex gap-1">
                  {supported && !isBusy && hasSelection && (
                    <button
                      onClick={() => setActiveKey(isActive ? null : key)}
                      className="px-2 py-0.5 border rounded text-orange-600 hover:bg-orange-50"
                      title={`只改写：${selectedText.slice(0, 40)}${selectedText.length > 40 ? "…" : ""}`}
                    >
                      🎯 重写选中
                    </button>
                  )}
                  {supported && !isBusy && !hasSelection && (
                    <button
                      onClick={() => setActiveKey(isActive ? null : key)}
                      className="opacity-0 group-hover:opacity-100 transition px-2 py-0.5 border rounded text-blue-600 hover:bg-blue-50"
                    >
                      🤖 重写整段
                    </button>
                  )}
                </div>
                {isBusy && <span className="text-blue-600">重写中…</span>}
              </header>
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
                    <button onClick={() => triggerRewrite(key, hasSelection)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">
                      {hasSelection ? "确认改片段" : "确认改整段"}
                    </button>
                    <button onClick={() => { setActiveKey(null); setHint(""); }} className="px-2 py-1 bg-gray-200 rounded text-xs">取消</button>
                  </div>
                </div>
              )}
              <article
                className="prose prose-sm max-w-none"
                onMouseUp={() => handleSelectionChange(key, body)}
                onKeyUp={() => handleSelectionChange(key, body)}
              >
                <ReactMarkdown>{body || "_(空)_"}</ReactMarkdown>
              </article>
              <ReferencePanel toolsUsed={toolsUsed} />
              {selectionRewriteOpen?.key === key && (
                <InlineComposer
                  projectId={projectId}
                  sectionKey={key}
                  selectedText={selectionRewriteOpen.text}
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

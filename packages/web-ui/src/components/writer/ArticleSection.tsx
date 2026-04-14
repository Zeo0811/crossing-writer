import { useEffect, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { useWriterSections } from "../../hooks/useWriterSections";
import { useProjectStream } from "../../hooks/useProjectStream";
import { getFinal, rewriteSectionStream } from "../../api/writer-client";

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

  const triggerRewrite = async (key: string) => {
    setActiveKey(null);
    setBusyKey(key);
    try {
      await rewriteSectionStream(projectId, key, hint || undefined, (ev) => {
        if (ev.type === "writer.rewrite_chunk" && ev.data?.chunk) {
          setBodies((b) => ({ ...b, [key]: ev.data.chunk }));
        }
      });
    } finally {
      setBusyKey(null);
      setHint("");
      reload();
    }
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

      <div className="flex flex-col gap-3">
        {renderOrder.map((key) => {
          const body = bodies[key] ?? "";
          const supported = rewriteSupported(key);
          const isActive = activeKey === key;
          const isBusy = busyKey === key;
          return (
            <section key={key} className="group relative border rounded p-3 bg-white hover:border-blue-400">
              <header className="flex justify-between items-center text-xs text-gray-500 mb-2">
                <span className="font-mono">{sectionTitle(key)}</span>
                {supported && !isBusy && (
                  <button
                    onClick={() => setActiveKey(isActive ? null : key)}
                    className="opacity-0 group-hover:opacity-100 transition px-2 py-0.5 border rounded text-blue-600 hover:bg-blue-50"
                  >
                    🤖 @agent 重写
                  </button>
                )}
                {isBusy && <span className="text-blue-600">重写中…</span>}
              </header>
              {isActive && (
                <div className="mb-2 flex gap-2">
                  <input
                    value={hint}
                    onChange={(e) => setHint(e.target.value)}
                    placeholder="给 agent 的提示（可空）"
                    className="flex-1 px-2 py-1 border rounded text-xs"
                  />
                  <button onClick={() => triggerRewrite(key)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">确认</button>
                  <button onClick={() => { setActiveKey(null); setHint(""); }} className="px-2 py-1 bg-gray-200 rounded text-xs">取消</button>
                </div>
              )}
              <article className="prose prose-sm max-w-none">
                <ReactMarkdown>{body || "_(空)_"}</ReactMarkdown>
              </article>
            </section>
          );
        })}
      </div>
    </div>
  );
}

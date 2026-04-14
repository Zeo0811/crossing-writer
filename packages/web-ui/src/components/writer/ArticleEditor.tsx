import { useEffect, useRef, useState, useCallback } from "react";
import { flushSync } from "react-dom";
import { getFinal, putSection, rewriteSectionStream } from "../../api/writer-client";

export interface ArticleEditorProps {
  projectId: string;
}

interface MarkerRange { key: string; headerStart: number; bodyStart: number; bodyEnd: number; }

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

function sectionKeyForSelection(content: string, start: number, end: number): string | null {
  const ranges = parseMarkers(content);
  const s = ranges.find((r) => start >= r.bodyStart && start <= r.bodyEnd);
  const e = ranges.find((r) => end >= r.bodyStart && end <= r.bodyEnd);
  if (!s || !e) return null;
  if (s.key !== e.key) return null;
  if (s.key.startsWith("transition.")) return null;
  return s.key;
}

function extractSectionBody(content: string, key: string): string {
  const ranges = parseMarkers(content);
  const r = ranges.find((x) => x.key === key);
  if (!r) return "";
  return content.slice(r.bodyStart, r.bodyEnd).trim();
}

function replaceSectionBody(content: string, key: string, newBody: string): string {
  const ranges = parseMarkers(content);
  const r = ranges.find((x) => x.key === key);
  if (!r) return content;
  return content.slice(0, r.bodyStart) + "\n" + newBody + "\n\n" + content.slice(r.bodyEnd);
}

export function ArticleEditor({ projectId }: ArticleEditorProps) {
  const [content, setContent] = useState("");
  const [selStart, setSelStart] = useState(0);
  const [selEnd, setSelEnd] = useState(0);
  const [rewriteOpen, setRewriteOpen] = useState(false);
  const [hint, setHint] = useState("");
  const [busySection, setBusySection] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>("");

  useEffect(() => {
    getFinal(projectId).then((txt) => {
      flushSync(() => { setContent(txt); });
      lastSavedRef.current = txt;
    }).catch(() => {});
  }, [projectId]);

  const onSelect = useCallback((e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const t = e.currentTarget;
    setSelStart(t.selectionStart);
    setSelEnd(t.selectionEnd);
  }, []);

  const currentKey = sectionKeyForSelection(content, selStart, selEnd);

  const triggerRewrite = async () => {
    if (!currentKey) return;
    setRewriteOpen(false);
    setBusySection(currentKey);
    try {
      await rewriteSectionStream(projectId, currentKey, hint || undefined, (ev) => {
        if (ev.type === "writer.rewrite_chunk" && ev.data?.chunk) {
          setContent((c) => replaceSectionBody(c, currentKey, ev.data.chunk));
        }
      });
    } finally {
      setBusySection(null);
      setHint("");
    }
  };

  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (content === lastSavedRef.current) return;
    saveTimerRef.current = setTimeout(async () => {
      const ranges = parseMarkers(content);
      for (const r of ranges) {
        if (r.key.startsWith("transition.")) continue;
        const body = content.slice(r.bodyStart, r.bodyEnd).trim();
        const prevBody = extractSectionBody(lastSavedRef.current, r.key);
        if (body !== prevBody) {
          try { await putSection(projectId, r.key, body); } catch {}
        }
      }
      lastSavedRef.current = content;
    }, 3000);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [content, projectId]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-2 p-2 border-b bg-gray-50">
        <button
          disabled={!currentKey || !!busySection}
          onClick={() => setRewriteOpen(true)}
          className="px-3 py-1 bg-blue-500 text-white rounded disabled:opacity-40"
        >
          🤖 @agent 重写
        </button>
        <a href={`/api/projects/${projectId}/writer/final`} download="final.md" className="px-3 py-1 bg-gray-200 rounded">导出 final.md</a>
        <span className="text-xs text-gray-500 ml-auto">{busySection ? `正在重写 ${busySection}…` : (currentKey ? `当前段：${currentKey}` : "未选中单一段落")}</span>
      </div>
      {rewriteOpen && (
        <div className="p-2 border-b bg-blue-50 flex gap-2">
          <input value={hint} onChange={(e) => setHint(e.target.value)} placeholder="给 agent 的提示（可空）" className="flex-1 px-2 py-1 border rounded" />
          <button onClick={triggerRewrite} className="px-3 py-1 bg-blue-600 text-white rounded">确认</button>
          <button onClick={() => setRewriteOpen(false)} className="px-3 py-1 bg-gray-300 rounded">取消</button>
        </div>
      )}
      <textarea
        role="textbox"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onSelect={onSelect}
        readOnly={!!busySection}
        className="flex-1 p-4 font-mono text-sm border-0 outline-none"
      />
    </div>
  );
}

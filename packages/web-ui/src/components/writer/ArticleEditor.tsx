import { useEffect, useMemo, useRef, useState, useCallback } from "react";
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
  if (!s || !e || s.key !== e.key) return null;
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

function sectionLabel(key: string): string {
  if (key === "opening") return "开篇";
  if (key === "closing") return "收束";
  if (key.startsWith("practice.case-")) {
    const n = key.slice("practice.case-".length);
    return `Case ${parseInt(n, 10)}`;
  }
  return key;
}

export function ArticleEditor({ projectId }: ArticleEditorProps) {
  const [content, setContent] = useState("");
  const [selStart, setSelStart] = useState(0);
  const [selEnd, setSelEnd] = useState(0);
  const [hint, setHint] = useState("");
  const [busySection, setBusySection] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>("");
  const taRef = useRef<HTMLTextAreaElement>(null);

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
  const hasSelection = selEnd > selStart;

  const sections = useMemo(() => parseMarkers(content).filter((r) => !r.key.startsWith("transition.")), [content]);

  const triggerRewrite = async () => {
    if (!currentKey) return;
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
      setLastSavedAt(new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    }, 3000);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [content, projectId]);

  function scrollToSection(key: string) {
    const r = parseMarkers(content).find((x) => x.key === key);
    if (!r || !taRef.current) return;
    taRef.current.focus();
    taRef.current.setSelectionRange(r.bodyStart, r.bodyStart);
    const line = content.slice(0, r.bodyStart).split("\n").length;
    taRef.current.scrollTop = Math.max(0, (line - 2) * 20);
    setSelStart(r.bodyStart);
    setSelEnd(r.bodyStart);
  }

  function copyMarkdown() {
    navigator.clipboard?.writeText(content).then(() => alert?.("已复制 markdown"));
  }

  return (
    <div className="grid grid-cols-[200px_1fr] gap-5 relative">
      <aside className="space-y-1.5">
        <div className="text-xs text-[var(--meta)] font-semibold mb-2">段落</div>
        {sections.map((s) => {
          const active = currentKey === s.key;
          const busy = busySection === s.key;
          return (
            <button
              key={s.key}
              onClick={() => scrollToSection(s.key)}
              className={`w-full text-left px-2.5 py-2 rounded text-xs flex items-center gap-2 ${
                active ? "bg-[var(--accent-fill)] text-[var(--heading)]" : "text-[var(--body)] hover:bg-[var(--bg-2)]"
              }`}
            >
              <span className={busy ? "text-[var(--amber)]" : "text-[var(--accent)]"}>{busy ? "…" : "✓"}</span>
              <span className="flex-1 truncate">{sectionLabel(s.key)}</span>
            </button>
          );
        })}
        <div className="pt-3 space-y-2">
          <button
            onClick={copyMarkdown}
            className="w-full px-3 py-2 rounded border border-[var(--hair)] text-xs text-[var(--meta)] hover:text-[var(--heading)]"
          >
            复制 markdown
          </button>
          <a
            href={`/api/projects/${projectId}/writer/final`}
            download="final.md"
            className="block w-full px-3 py-2 rounded border border-[var(--hair)] text-xs text-[var(--meta)] hover:text-[var(--heading)] text-center no-underline"
          >
            导出 final.md
          </a>
        </div>
      </aside>

      <main className="space-y-3">
        <div className="rounded bg-[var(--bg-2)] p-0 relative">
          <textarea
            ref={taRef}
            role="textbox"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onSelect={onSelect}
            readOnly={!!busySection}
            className="w-full min-h-[420px] bg-transparent p-5 text-sm text-[var(--body)] outline-none resize-none leading-relaxed"
            style={{ fontFamily: "var(--font-mono)" }}
          />
          {hasSelection && currentKey && !busySection && (
            <div className="absolute right-5 top-5 rounded border border-[var(--accent-soft)] bg-[var(--bg-1)] p-3 shadow-lg w-[320px] z-10">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs text-[var(--accent)] font-semibold">改写所选片段 · {sectionLabel(currentKey)}</div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={hint}
                  onChange={(e) => setHint(e.target.value)}
                  placeholder="提示（可空）：更口语 / 更短 / 加一个数据点"
                  onKeyDown={(e) => { if (e.key === "Enter") void triggerRewrite(); }}
                  className="flex-1 bg-[var(--bg-2)] border border-[var(--hair)] rounded px-2 py-1.5 text-xs outline-none focus:border-[var(--accent)]"
                />
                <button
                  onClick={triggerRewrite}
                  className="px-3 py-1.5 rounded bg-[var(--accent)] text-[var(--accent-on)] text-xs font-semibold"
                >
                  改写
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between text-xs text-[var(--meta)]">
          <span>
            {busySection
              ? `正在重写 ${sectionLabel(busySection)}…`
              : currentKey
                ? `当前段：${sectionLabel(currentKey)}`
                : hasSelection
                  ? "选中跨多段，无法改写"
                  : "选中某段文字可调用 agent 改写"}
            {lastSavedAt && <span className="ml-3 text-[var(--faint)]">· 自动保存 {lastSavedAt}</span>}
          </span>
          <div className="flex gap-2">
            <button
              disabled={!currentKey || !!busySection}
              onClick={() => setHint("")}
              className="px-3 py-1 rounded border border-[var(--hair-strong)] text-[var(--meta)] hover:text-[var(--heading)] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              清除选中
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

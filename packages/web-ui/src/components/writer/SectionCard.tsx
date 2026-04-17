import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useSectionRewriteState } from '../../hooks/useSectionRewriteState.js';
import { useRewriteMutex } from '../../hooks/useRewriteMutex.js';
import { useTextSelection } from '../../hooks/useTextSelection.js';
import { ToolTimeline } from './ToolTimeline.js';
import { SectionDiff } from './SectionDiff.js';
import { SelectionBubble } from './SelectionBubble.js';
import { MentionDropdown, SKILL_ITEMS, type MentionSkillItem } from './MentionDropdown.js';
import { putSection } from '../../api/writer-client.js';

export interface SectionCardProps {
  projectId: string;
  sectionKey: string;
  label: string;
  initialBody: string;
}

const mdComponents: Components = {
  h1: ({ children }) => <h2 className="text-base font-semibold text-[var(--heading)] mt-4 mb-2">{children}</h2>,
  h2: ({ children }) => <h3 className="text-base font-semibold text-[var(--heading)] mt-4 mb-2">{children}</h3>,
  h3: ({ children }) => <h4 className="text-sm font-semibold text-[var(--heading)] mt-3 mb-1.5">{children}</h4>,
  p: ({ children }) => <p className="text-sm text-[var(--body)] leading-relaxed my-2">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-[var(--heading)]">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[var(--accent)] underline underline-offset-2 hover:opacity-80"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="list-disc pl-5 my-2 space-y-1 text-sm">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 my-2 space-y-1 text-sm">{children}</ol>,
  li: ({ children }) => <li className="text-[var(--body)]">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-[var(--accent-soft,#ddd)] pl-3 my-2 text-[var(--meta)] italic text-sm">
      {children}
    </blockquote>
  ),
  code: ({ children }) => (
    <code className="bg-[var(--bg-2)] px-1 py-0.5 rounded text-[13px]" style={{ fontFamily: 'var(--font-mono)' }}>
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="bg-[var(--bg-2)] p-3 rounded overflow-x-auto text-[13px] my-2" style={{ fontFamily: 'var(--font-mono)' }}>
      {children}
    </pre>
  ),
  hr: () => <hr className="border-[var(--hair)] my-3" />,
  table: ({ children }) => (
    <div className="overflow-x-auto my-2">
      <table className="text-sm border-collapse">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-[var(--hair)] px-2 py-1 bg-[var(--bg-2)] text-left font-semibold">{children}</th>
  ),
  td: ({ children }) => <td className="border border-[var(--hair)] px-2 py-1">{children}</td>,
  del: ({ children }) => <del className="text-[var(--meta)] line-through">{children}</del>,
};

export function SectionCard({ projectId, sectionKey, label, initialBody }: SectionCardProps) {
  const state = useSectionRewriteState({ projectId, sectionKey, initialBody });
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const selection = useTextSelection(bodyRef);
  const mutex = useRewriteMutex();
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedBodyRef = useRef<string>(initialBody);

  const [mention, setMention] = useState<{ active: boolean; start: number; activeIndex: number }>({
    active: false,
    start: -1,
    activeIndex: 0,
  });
  const hintTaRef = useRef<HTMLTextAreaElement | null>(null);

  const closeMention = () => setMention({ active: false, start: -1, activeIndex: 0 });

  function onHintChange(e: ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value;
    state.setHint(next);
    const caret = e.target.selectionStart ?? next.length;
    const before = next.slice(0, caret);
    const at = before.lastIndexOf('@');
    if (at >= 0) {
      const frag = before.slice(at + 1);
      if (!/\s/.test(frag) && frag.length <= 40) {
        setMention({ active: true, start: at, activeIndex: 0 });
        return;
      }
    }
    closeMention();
  }

  function insertSkill(item: MentionSkillItem) {
    const ta = hintTaRef.current;
    const caret = ta?.selectionStart ?? state.hint.length;
    const start = mention.start >= 0 ? mention.start : caret;
    const before = state.hint.slice(0, start);
    const after = state.hint.slice(caret);
    const nextVal = before + item.insertText + after;
    state.setHint(nextVal);
    closeMention();
    queueMicrotask(() => {
      const pos = before.length + item.insertText.length;
      ta?.setSelectionRange(pos, pos);
      ta?.focus();
    });
  }

  function onHintKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (mention.active) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMention((m) => ({ ...m, activeIndex: Math.min(SKILL_ITEMS.length - 1, m.activeIndex + 1) }));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMention((m) => ({ ...m, activeIndex: Math.max(0, m.activeIndex - 1) }));
        return;
      }
      if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        insertSkill(SKILL_ITEMS[mention.activeIndex]!);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closeMention();
        return;
      }
    }
  }

  const canRewrite = mutex.activeKey === null || mutex.activeKey === sectionKey;

  // Auto-save in edit mode
  useEffect(() => {
    if (state.mode !== 'edit') return;
    if (state.body === lastSavedBodyRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await putSection(projectId, sectionKey, state.body);
        lastSavedBodyRef.current = state.body;
        setSavedAt(new Date().toLocaleTimeString('zh-CN'));
      } catch {
        /* ignore; user can retry */
      }
    }, 3000);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [state.mode, state.body, projectId, sectionKey]);

  const charCount = state.body.length;
  const unsaved = state.mode === 'edit' && state.body !== lastSavedBodyRef.current;

  return (
    <article
      data-testid={`card-${sectionKey}`}
      className="rounded border border-[var(--hair)] bg-[var(--bg-1)] overflow-hidden"
    >
      <header className="flex items-center justify-between px-4 h-10 border-b border-[var(--hair)] text-xs">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-[var(--heading)]">{label}</span>
          <span className="text-[var(--meta)]">{charCount} 字</span>
          {unsaved && <span className="text-[var(--amber,orange)]">● 未保存</span>}
          {!unsaved && savedAt && <span className="text-[var(--faint)]">✓ 已保存 · {savedAt}</span>}
          {mutex.activeKey === sectionKey && state.mode === 'rewrite_streaming' && (
            <span className="text-[var(--accent)]">⋯ 正在改写</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {state.mode === 'view' && (
            <>
              <button className="px-2.5 py-1 rounded border border-[var(--hair)] hover:border-[var(--accent)]" onClick={() => state.enterEdit()}>编辑</button>
              <button
                disabled={!canRewrite}
                className="px-2.5 py-1 rounded bg-[var(--accent)] text-[var(--accent-on)] disabled:opacity-40 disabled:cursor-not-allowed"
                onClick={() => state.enterRewrite()}
              >
                改写整段
              </button>
              {state.lastAcceptedBody !== null && (
                <button className="px-2.5 py-1 rounded border border-[var(--hair)] text-[var(--meta)] hover:text-[var(--heading)]" onClick={() => void state.undo()}>
                  ↶ 撤回
                </button>
              )}
            </>
          )}
          {state.mode === 'edit' && (
            <button className="px-2.5 py-1 rounded border border-[var(--hair)]" onClick={() => state.exitEdit()}>
              完成
            </button>
          )}
          {(state.mode === 'rewrite_idle' || state.mode === 'rewrite_done') && (
            <button className="px-2.5 py-1 rounded border border-[var(--hair)]" onClick={() => state.cancelRewrite()}>
              取消
            </button>
          )}
        </div>
      </header>

      {state.mode === 'view' && (
        <div ref={bodyRef} className="px-4 py-4 text-[var(--body)] leading-relaxed">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
            {state.body}
          </ReactMarkdown>
        </div>
      )}

      {state.mode === 'view' && selection.text && selection.rect && (
        <SelectionBubble
          rect={selection.rect}
          onClick={() => state.enterRewrite(selection.text)}
        />
      )}

      {state.mode === 'edit' && (
        <textarea
          role="textbox"
          value={state.body}
          onChange={(e) => state.setBody(e.target.value)}
          className="w-full min-h-[200px] bg-[var(--bg-2)] p-4 text-sm leading-relaxed outline-none"
          style={{ fontFamily: 'var(--font-mono)' }}
        />
      )}

      {(state.mode === 'rewrite_idle' || state.mode === 'rewrite_streaming') && (
        <div className="p-4 space-y-3">
          {state.selectedText && (
            <div className="border-l-2 border-[var(--accent)] pl-3 text-xs text-[var(--meta)]">
              <div className="mb-1 text-[var(--faint)]">只改写所选片段：</div>
              <div className="italic">{state.selectedText}</div>
            </div>
          )}
          <div className="relative">
            <textarea
              ref={hintTaRef}
              value={state.hint}
              onChange={onHintChange}
              onKeyDown={onHintKeyDown}
              placeholder="改写提示（多行可，@ 触发 skill 补全）：更口语 / @search_wiki 查一下 / 加一个数据点 ..."
              className="w-full min-h-[80px] bg-[var(--bg-2)] p-3 text-sm outline-none border border-[var(--hair)] rounded"
              disabled={state.mode === 'rewrite_streaming'}
            />
            {mention.active && (
              <div className="absolute left-0 top-full mt-1">
                <MentionDropdown
                  items={SKILL_ITEMS}
                  activeIndex={mention.activeIndex}
                  onSelect={insertSkill}
                  onHover={(i) => setMention((m) => ({ ...m, activeIndex: i }))}
                />
              </div>
            )}
          </div>
          <div className={state.timeline.length > 0 ? "grid grid-cols-[1fr_280px] gap-4" : ""}>
            <div>
              {state.mode === 'rewrite_idle' ? (
                <button
                  onClick={() => void state.triggerRewrite()}
                  className="px-3 py-1.5 rounded bg-[var(--accent)] text-[var(--accent-on)] text-sm"
                >
                  改写
                </button>
              ) : (
                <div className="text-sm text-[var(--meta)]">正在改写，请稍候…</div>
              )}
            </div>
            {state.timeline.length > 0 && (
              <div className="rounded bg-[var(--bg-2)] p-3">
                <div className="text-xs text-[var(--meta)] mb-2">活动日志</div>
                <ToolTimeline events={state.timeline} />
              </div>
            )}
          </div>
        </div>
      )}

      {state.mode === 'rewrite_done' && state.draftBody !== null && (
        <div className="p-4 space-y-3">
          <div className="text-xs text-[var(--meta)]">改写完成 · 对比前后：</div>
          <div className="rounded bg-[var(--bg-2)] p-3 max-h-[400px] overflow-y-auto">
            <SectionDiff oldText={state.body} newText={state.draftBody} />
          </div>
          {state.timeline.length > 0 && (
            <div className="rounded bg-[var(--bg-2)] p-3">
              <div className="text-xs text-[var(--meta)] mb-2">活动日志</div>
              <ToolTimeline events={state.timeline} />
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={() => void state.accept()}
              className="px-3 py-1.5 rounded bg-[var(--accent)] text-[var(--accent-on)] text-sm"
            >
              接受改写
            </button>
            <button
              onClick={() => state.reject()}
              className="px-3 py-1.5 rounded border border-[var(--hair)] text-sm"
            >
              驳回
            </button>
            <button
              onClick={() => void state.triggerRewrite()}
              className="px-3 py-1.5 rounded border border-[var(--hair)] text-sm"
            >
              再改一次
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

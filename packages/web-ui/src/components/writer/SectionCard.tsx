import { useEffect, useRef, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useSectionRewriteState } from '../../hooks/useSectionRewriteState.js';
import { useRewriteMutex } from '../../hooks/useRewriteMutex.js';
import { useTextSelection } from '../../hooks/useTextSelection.js';
import { SelectionBubble } from './SelectionBubble.js';
import { RewriteModal } from './RewriteModal.js';
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

  const canRewrite = mutex.activeKey === null || mutex.activeKey === sectionKey;
  const isRewriting =
    state.mode === 'rewrite_idle' ||
    state.mode === 'rewrite_streaming' ||
    state.mode === 'rewrite_done';

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
      className="rounded border border-[var(--hair)] bg-[var(--bg-1)]"
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
        </div>
      </header>

      {(state.mode === 'view' || isRewriting) && (
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

      {isRewriting && (
        <RewriteModal
          label={label}
          mode={state.mode}
          hint={state.hint}
          setHint={state.setHint}
          selectedText={state.selectedText}
          timeline={state.timeline}
          oldBody={state.body}
          draftBody={state.draftBody}
          onTrigger={() => void state.triggerRewrite()}
          onAccept={() => void state.accept()}
          onReject={() => state.reject()}
          onRetry={() => void state.triggerRewrite()}
          onClose={() => state.cancelRewrite()}
        />
      )}
    </article>
  );
}

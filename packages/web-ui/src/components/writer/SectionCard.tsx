import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useSectionRewriteState } from '../../hooks/useSectionRewriteState.js';
import { useRewriteMutex } from '../../hooks/useRewriteMutex.js';
import { ToolTimeline } from './ToolTimeline.js';
import { SectionDiff } from './SectionDiff.js';
import { putSection } from '../../api/writer-client.js';

export interface SectionCardProps {
  projectId: string;
  sectionKey: string;
  label: string;
  initialBody: string;
}

export function SectionCard({ projectId, sectionKey, label, initialBody }: SectionCardProps) {
  const state = useSectionRewriteState({ projectId, sectionKey, initialBody });
  const mutex = useRewriteMutex();
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedBodyRef = useRef<string>(initialBody);

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
        <div className="px-4 py-4 text-sm text-[var(--body)] leading-relaxed">
          <ReactMarkdown>{state.body}</ReactMarkdown>
        </div>
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
          <textarea
            value={state.hint}
            onChange={(e) => state.setHint(e.target.value)}
            placeholder="改写提示（多行可）：更口语 / 加一个数据点 / 去掉最后两句 ..."
            className="w-full min-h-[80px] bg-[var(--bg-2)] p-3 text-sm outline-none border border-[var(--hair)] rounded"
            disabled={state.mode === 'rewrite_streaming'}
          />
          <div className="grid grid-cols-[1fr_280px] gap-4">
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
            <div className="rounded bg-[var(--bg-2)] p-3">
              <div className="text-xs text-[var(--meta)] mb-2">活动日志</div>
              <ToolTimeline events={state.timeline} />
            </div>
          </div>
        </div>
      )}

      {state.mode === 'rewrite_done' && state.draftBody !== null && (
        <div className="p-4 space-y-3">
          <div className="text-xs text-[var(--meta)]">改写完成 · 对比前后：</div>
          <div className="rounded bg-[var(--bg-2)] p-3 max-h-[400px] overflow-y-auto">
            <SectionDiff oldText={state.body} newText={state.draftBody} />
          </div>
          <div className="rounded bg-[var(--bg-2)] p-3">
            <div className="text-xs text-[var(--meta)] mb-2">活动日志</div>
            <ToolTimeline events={state.timeline} />
          </div>
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

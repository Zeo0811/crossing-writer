import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { ToolTimeline, type TimelineEvent } from './ToolTimeline.js';
import { SectionDiff } from './SectionDiff.js';
import { MentionDropdown, SKILL_ITEMS, type MentionSkillItem } from './MentionDropdown.js';

export interface RewriteModalProps {
  label: string;
  mode: 'rewrite_idle' | 'rewrite_streaming' | 'rewrite_done';
  hint: string;
  setHint(next: string): void;
  selectedText: string | null;
  timeline: TimelineEvent[];
  oldBody: string;
  draftBody: string | null;
  onTrigger(): void;
  onAccept(): void;
  onReject(): void;
  onRetry(): void;
  onClose(): void;
}

interface MentionState {
  active: boolean;
  start: number;
  activeIndex: number;
}

const EMPTY_MENTION: MentionState = { active: false, start: -1, activeIndex: 0 };

export function RewriteModal(props: RewriteModalProps) {
  const {
    label, mode, hint, setHint, selectedText, timeline, oldBody, draftBody,
    onTrigger, onAccept, onReject, onRetry, onClose,
  } = props;

  const hintTaRef = useRef<HTMLTextAreaElement | null>(null);
  const [mention, setMention] = useState<MentionState>(EMPTY_MENTION);

  // Esc → close (only when not streaming)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && mode !== 'rewrite_streaming' && !mention.active) {
        onClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [mode, mention.active, onClose]);

  function onHintChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value;
    setHint(next);
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
    setMention(EMPTY_MENTION);
  }

  function insertSkill(item: MentionSkillItem) {
    const ta = hintTaRef.current;
    const caret = ta?.selectionStart ?? hint.length;
    const start = mention.start >= 0 ? mention.start : caret;
    const before = hint.slice(0, start);
    const after = hint.slice(caret);
    const nextVal = before + item.insertText + after;
    setHint(nextVal);
    setMention(EMPTY_MENTION);
    queueMicrotask(() => {
      const pos = before.length + item.insertText.length;
      ta?.setSelectionRange(pos, pos);
      ta?.focus();
    });
  }

  function onHintKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
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
        setMention(EMPTY_MENTION);
        return;
      }
    }
  }

  const panel = (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4"
      onClick={() => { if (mode !== 'rewrite_streaming') onClose(); }}
    >
      <div
        className="bg-[var(--bg-1)] rounded-lg shadow-2xl w-[min(760px,94vw)] max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 h-12 border-b border-[var(--hair)] flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-[var(--heading)]">改写 · {label}</span>
            {mode === 'rewrite_streaming' && <span className="text-xs text-[var(--accent)]">⋯ 进行中</span>}
            {mode === 'rewrite_done' && <span className="text-xs text-[var(--accent)]">✓ 完成</span>}
          </div>
          <button
            onClick={onClose}
            disabled={mode === 'rewrite_streaming'}
            className="px-2 py-1 rounded text-[var(--meta)] hover:text-[var(--heading)] disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {selectedText && (
            <div className="border-l-2 border-[var(--accent)] pl-3 text-xs text-[var(--meta)] bg-[var(--bg-2)] p-2 rounded-sm">
              <div className="mb-1 text-[var(--faint)] font-semibold">只改写所选片段：</div>
              <div className="italic">{selectedText}</div>
            </div>
          )}

          {mode !== 'rewrite_done' && (
            <div className="relative">
              <label className="block text-xs text-[var(--meta)] mb-1 font-semibold">改写提示</label>
              <textarea
                ref={hintTaRef}
                value={hint}
                onChange={onHintChange}
                onKeyDown={onHintKeyDown}
                placeholder="多行可，@ 触发 skill 补全：更口语 / @search_wiki 查一下 / 加一个数据点 ..."
                className="w-full min-h-[100px] bg-[var(--bg-2)] p-3 text-sm outline-none border border-[var(--hair)] rounded focus:border-[var(--accent)]"
                disabled={mode === 'rewrite_streaming'}
                autoFocus
              />
              {mention.active && (
                <div className="absolute left-0 top-full mt-1 z-10">
                  <MentionDropdown
                    items={SKILL_ITEMS}
                    activeIndex={mention.activeIndex}
                    onSelect={insertSkill}
                    onHover={(i) => setMention((m) => ({ ...m, activeIndex: i }))}
                  />
                </div>
              )}
            </div>
          )}

          {mode === 'rewrite_done' && draftBody !== null && (
            <div>
              <div className="text-xs text-[var(--meta)] mb-2 font-semibold">改写对比</div>
              <div className="rounded bg-[var(--bg-2)] p-3 max-h-[360px] overflow-y-auto">
                <SectionDiff oldText={oldBody} newText={draftBody} />
              </div>
            </div>
          )}

          {timeline.length > 0 && (
            <div>
              <div className="text-xs text-[var(--meta)] mb-2 font-semibold">活动日志</div>
              <div className="rounded bg-[var(--bg-2)] p-3 max-h-[200px] overflow-y-auto">
                <ToolTimeline events={timeline} />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 h-14 border-t border-[var(--hair)] flex-shrink-0">
          {mode === 'rewrite_idle' && (
            <>
              <button onClick={onClose} className="px-3 py-1.5 rounded border border-[var(--hair)] text-sm text-[var(--body)]">
                取消
              </button>
              <button
                onClick={onTrigger}
                disabled={!hint.trim()}
                className="px-4 py-1.5 rounded bg-[var(--accent)] text-[var(--accent-on,white)] text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
              >
                改写
              </button>
            </>
          )}
          {mode === 'rewrite_streaming' && (
            <div className="text-sm text-[var(--meta)]">正在改写，请稍候…</div>
          )}
          {mode === 'rewrite_done' && (
            <>
              <button onClick={onReject} className="px-3 py-1.5 rounded border border-[var(--hair)] text-sm text-[var(--body)]">
                驳回
              </button>
              <button onClick={onRetry} className="px-3 py-1.5 rounded border border-[var(--hair)] text-sm text-[var(--body)]">
                再改一次
              </button>
              <button
                onClick={onAccept}
                className="px-4 py-1.5 rounded bg-[var(--accent)] text-[var(--accent-on,white)] text-sm font-medium"
              >
                接受改写
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );

  // Portal to body so nothing in the page tree can clip us.
  if (typeof document === 'undefined') return null;
  return createPortal(panel, document.body);
}

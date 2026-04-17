import { useCallback, useState } from 'react';
import {
  rewriteSectionStream,
  putSection,
  type RewriteStreamEvent,
} from '../api/writer-client.js';
import { useRewriteMutex } from './useRewriteMutex.js';
import type { TimelineEvent } from '../components/writer/ToolTimeline.js';

export type SectionMode =
  | 'view'
  | 'edit'
  | 'rewrite_idle'
  | 'rewrite_streaming'
  | 'rewrite_done';

export interface UseSectionRewriteStateOpts {
  projectId: string;
  sectionKey: string;
  initialBody: string;
  label?: string;
}

export interface SectionRewriteState {
  mode: SectionMode;
  body: string;
  draftBody: string | null;
  lastAcceptedBody: string | null;
  timeline: TimelineEvent[];
  selectedText: string | null;
  hint: string;

  setBody(next: string): void;
  setHint(next: string): void;
  enterEdit(): void;
  exitEdit(): void;
  enterRewrite(selection?: string): void;
  cancelRewrite(): void;
  triggerRewrite(hint?: string): Promise<void>;
  accept(): Promise<void>;
  reject(): void;
  undo(): Promise<void>;
}

function streamEventToTimeline(ev: RewriteStreamEvent, ts: number): TimelineEvent | null {
  switch (ev.type) {
    case 'writer.tool_called':
      return { kind: 'tool_called', tool: ev.data.tool, args: ev.data.args, ts };
    case 'writer.tool_returned':
      return { kind: 'tool_returned', tool: ev.data.tool, hits_count: ev.data.hits_count, duration_ms: ev.data.duration_ms, ts };
    case 'writer.tool_round_completed':
      return { kind: 'tool_round_completed', round: ev.data.round, total_tools: ev.data.total_tools_in_round, ts };
    case 'writer.validation_passed':
      return { kind: 'validation_passed', attempt: ev.data.attempt, chars: ev.data.chars, ts };
    case 'writer.validation_retry':
      return { kind: 'validation_retry', violations: ev.data.violations, ts };
    case 'writer.validation_failed':
      return { kind: 'validation_failed', violations: ev.data.violations, ts };
    case 'writer.rewrite_completed':
      return { kind: 'rewrite_completed', ts };
    default:
      return null;
  }
}

export function useSectionRewriteState(opts: UseSectionRewriteStateOpts): SectionRewriteState {
  const { projectId, sectionKey, initialBody, label } = opts;
  const mutex = useRewriteMutex();

  const [mode, setMode] = useState<SectionMode>('view');
  const [body, setBodyState] = useState<string>(initialBody);
  const [draftBody, setDraftBody] = useState<string | null>(null);
  const [lastAcceptedBody, setLastAcceptedBody] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [hint, setHintState] = useState<string>('');

  const setBody = useCallback((next: string) => setBodyState(next), []);
  const setHint = useCallback((next: string) => setHintState(next), []);

  const enterEdit = useCallback(() => setMode('edit'), []);
  const exitEdit = useCallback(() => setMode('view'), []);

  const enterRewrite = useCallback((selection?: string) => {
    setSelectedText(selection ?? null);
    setMode('rewrite_idle');
    setTimeline([]);
    setDraftBody(null);
  }, []);

  const cancelRewrite = useCallback(() => {
    setMode('view');
    setSelectedText(null);
    setTimeline([]);
    setDraftBody(null);
    setHintState('');
  }, []);

  const triggerRewrite = useCallback(async (overrideHint?: string): Promise<void> => {
    if (!mutex.acquire(sectionKey)) return;
    setMode('rewrite_streaming');
    setTimeline([]);
    mutex.startRun(sectionKey, label ?? sectionKey);
    let accumulated = '';
    try {
      await rewriteSectionStream(
        projectId,
        sectionKey,
        {
          hint: overrideHint ?? hint,
          ...(selectedText ? { selected_text: selectedText } : {}),
        },
        (ev) => {
          if (ev.type === 'writer.rewrite_chunk') {
            accumulated = ev.data.chunk;
            setDraftBody(accumulated);
          } else {
            const te = streamEventToTimeline(ev, Date.now());
            if (te) {
              setTimeline((prev) => [...prev, te]);
              mutex.appendTimeline(sectionKey, te);
            }
          }
        },
      );
      setDraftBody(accumulated);
      setMode('rewrite_done');
      mutex.finishRun(sectionKey, 'done');
    } catch (err) {
      const errEvent: TimelineEvent = {
        kind: 'validation_failed',
        violations: [{ error: (err as Error).message }],
        ts: Date.now(),
      };
      setTimeline((prev) => [...prev, errEvent]);
      mutex.appendTimeline(sectionKey, errEvent);
      mutex.finishRun(sectionKey, 'error');
      setMode('rewrite_idle');
    } finally {
      mutex.release(sectionKey);
    }
  }, [projectId, sectionKey, hint, selectedText, label, mutex]);

  const accept = useCallback(async (): Promise<void> => {
    if (draftBody === null) return;
    const prev = body;
    await putSection(projectId, sectionKey, draftBody);
    setBodyState(draftBody);
    setLastAcceptedBody(prev);
    setDraftBody(null);
    setMode('view');
    setHintState('');
    setSelectedText(null);
  }, [projectId, sectionKey, body, draftBody]);

  const reject = useCallback(() => {
    setDraftBody(null);
    setMode('view');
    setHintState('');
    setSelectedText(null);
  }, []);

  const undo = useCallback(async (): Promise<void> => {
    if (lastAcceptedBody === null) return;
    await putSection(projectId, sectionKey, lastAcceptedBody);
    setBodyState(lastAcceptedBody);
    setLastAcceptedBody(null);
  }, [projectId, sectionKey, lastAcceptedBody]);

  return {
    mode, body, draftBody, lastAcceptedBody, timeline, selectedText, hint,
    setBody, setHint,
    enterEdit, exitEdit,
    enterRewrite, cancelRewrite, triggerRewrite,
    accept, reject, undo,
  };
}

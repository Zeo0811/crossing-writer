import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSectionRewriteState } from '../useSectionRewriteState.js';
import { RewriteMutexProvider } from '../useRewriteMutex.js';
import type { ReactNode } from 'react';
import type { RewriteStreamEvent } from '../../api/writer-client.js';

vi.mock('../../api/writer-client.js', () => ({
  rewriteSectionStream: vi.fn(),
  putSection: vi.fn(async () => {}),
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <RewriteMutexProvider>{children}</RewriteMutexProvider>
);

function mockStream(events: RewriteStreamEvent[]) {
  return vi.fn(async (
    _projectId: string,
    _sectionKey: string,
    _opts: { hint?: string; selected_text?: string },
    onEvent: (e: RewriteStreamEvent) => void,
  ) => {
    for (const ev of events) onEvent(ev);
  });
}

beforeEach(async () => {
  const mod = await import('../../api/writer-client.js');
  (mod.rewriteSectionStream as any).mockReset();
  (mod.putSection as any).mockReset();
  (mod.putSection as any).mockResolvedValue(undefined);
});

describe('useSectionRewriteState', () => {
  it('initial state: mode=view, timeline empty, no draft', () => {
    const { result } = renderHook(
      () => useSectionRewriteState({ projectId: 'p', sectionKey: 'opening', initialBody: 'hello' }),
      { wrapper },
    );
    expect(result.current.mode).toBe('view');
    expect(result.current.timeline).toEqual([]);
    expect(result.current.draftBody).toBeNull();
    expect(result.current.body).toBe('hello');
  });

  it('enterEdit switches to edit mode', () => {
    const { result } = renderHook(
      () => useSectionRewriteState({ projectId: 'p', sectionKey: 'opening', initialBody: 'hello' }),
      { wrapper },
    );
    act(() => { result.current.enterEdit(); });
    expect(result.current.mode).toBe('edit');
  });

  it('setBody updates body in edit mode', () => {
    const { result } = renderHook(
      () => useSectionRewriteState({ projectId: 'p', sectionKey: 'opening', initialBody: 'hello' }),
      { wrapper },
    );
    act(() => { result.current.enterEdit(); });
    act(() => { result.current.setBody('hello world'); });
    expect(result.current.body).toBe('hello world');
  });

  it('enterRewrite switches to rewrite_idle with optional selection', () => {
    const { result } = renderHook(
      () => useSectionRewriteState({ projectId: 'p', sectionKey: 'opening', initialBody: 'hello' }),
      { wrapper },
    );
    act(() => { result.current.enterRewrite('hello'); });
    expect(result.current.mode).toBe('rewrite_idle');
    expect(result.current.selectedText).toBe('hello');
  });

  it('triggerRewrite streams events into timeline + updates draftBody; enters rewrite_done', async () => {
    const mod = await import('../../api/writer-client.js');
    (mod.rewriteSectionStream as any).mockImplementation(mockStream([
      { type: 'writer.tool_called', data: { tool: 'search_wiki', args: {}, round: 1, section_key: 'opening', agent: 'writer.opening' } },
      { type: 'writer.tool_returned', data: { tool: 'search_wiki', hits_count: 3, duration_ms: 20, round: 1, section_key: 'opening', agent: 'writer.opening' } },
      { type: 'writer.validation_passed', data: { attempt: 1, chars: 300, section_key: 'opening', agent: 'writer.opening' } },
      { type: 'writer.rewrite_chunk', data: { section_key: 'opening', chunk: 'new body' } },
      { type: 'writer.rewrite_completed', data: { section_key: 'opening', last_agent: 'writer.opening' } },
    ]));

    const { result } = renderHook(
      () => useSectionRewriteState({ projectId: 'p', sectionKey: 'opening', initialBody: 'old body' }),
      { wrapper },
    );

    act(() => { result.current.enterRewrite(); });
    await act(async () => { await result.current.triggerRewrite('更口语'); });

    expect(result.current.mode).toBe('rewrite_done');
    // timeline: tool_called + tool_returned + validation_passed + rewrite_completed = 4
    // rewrite_chunk is data-only, not in timeline
    expect(result.current.timeline).toHaveLength(4);
    expect(result.current.draftBody).toBe('new body');
  });

  it('accept calls putSection + sets lastAcceptedBody + returns to view', async () => {
    const mod = await import('../../api/writer-client.js');
    (mod.rewriteSectionStream as any).mockImplementation(mockStream([
      { type: 'writer.rewrite_chunk', data: { section_key: 'opening', chunk: 'new body' } },
      { type: 'writer.rewrite_completed', data: { section_key: 'opening', last_agent: 'writer.opening' } },
    ]));

    const { result } = renderHook(
      () => useSectionRewriteState({ projectId: 'p', sectionKey: 'opening', initialBody: 'old body' }),
      { wrapper },
    );

    act(() => { result.current.enterRewrite(); });
    await act(async () => { await result.current.triggerRewrite(); });
    await act(async () => { await result.current.accept(); });

    expect(mod.putSection).toHaveBeenCalledWith('p', 'opening', 'new body');
    expect(result.current.body).toBe('new body');
    expect(result.current.lastAcceptedBody).toBe('old body');
    expect(result.current.mode).toBe('view');
  });

  it('reject drops draftBody + returns to view without putSection', async () => {
    const mod = await import('../../api/writer-client.js');
    (mod.rewriteSectionStream as any).mockImplementation(mockStream([
      { type: 'writer.rewrite_chunk', data: { section_key: 'opening', chunk: 'new body' } },
      { type: 'writer.rewrite_completed', data: { section_key: 'opening', last_agent: 'writer.opening' } },
    ]));

    const { result } = renderHook(
      () => useSectionRewriteState({ projectId: 'p', sectionKey: 'opening', initialBody: 'old body' }),
      { wrapper },
    );

    act(() => { result.current.enterRewrite(); });
    await act(async () => { await result.current.triggerRewrite(); });
    act(() => { result.current.reject(); });

    expect(mod.putSection).not.toHaveBeenCalled();
    expect(result.current.body).toBe('old body');
    expect(result.current.mode).toBe('view');
    expect(result.current.draftBody).toBeNull();
  });

  it('undo restores lastAcceptedBody via putSection', async () => {
    const mod = await import('../../api/writer-client.js');
    (mod.rewriteSectionStream as any).mockImplementation(mockStream([
      { type: 'writer.rewrite_chunk', data: { section_key: 'opening', chunk: 'new body' } },
      { type: 'writer.rewrite_completed', data: { section_key: 'opening', last_agent: 'writer.opening' } },
    ]));

    const { result } = renderHook(
      () => useSectionRewriteState({ projectId: 'p', sectionKey: 'opening', initialBody: 'old body' }),
      { wrapper },
    );

    act(() => { result.current.enterRewrite(); });
    await act(async () => { await result.current.triggerRewrite(); });
    await act(async () => { await result.current.accept(); });
    expect(result.current.body).toBe('new body');

    await act(async () => { await result.current.undo(); });
    expect(result.current.body).toBe('old body');
    expect(result.current.lastAcceptedBody).toBeNull();
    expect(mod.putSection).toHaveBeenLastCalledWith('p', 'opening', 'old body');
  });
});

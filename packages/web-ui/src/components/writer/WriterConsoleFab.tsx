import { useState } from 'react';
import { useRewriteMutex, type RewriteConsoleRun } from '../../hooks/useRewriteMutex.js';
import { ToolTimeline } from './ToolTimeline.js';

function TerminalIcon() {
  return (
    <svg
      width="22" height="22" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden
    >
      <polyline points="5 9 9 12 5 15" />
      <line x1="12" y1="15" x2="17" y2="15" />
    </svg>
  );
}

function formatDuration(run: RewriteConsoleRun): string {
  if (run.timeline.length === 0) return '—';
  const last = run.timeline[run.timeline.length - 1]!.ts;
  const seconds = Math.max(0, Math.round((last - run.startedAt) / 1000));
  return `${seconds}s`;
}

function statusLabel(s: RewriteConsoleRun['status']): string {
  switch (s) {
    case 'running': return '进行中';
    case 'done': return '完成';
    case 'error': return '出错';
    default: return '—';
  }
}

function statusClasses(s: RewriteConsoleRun['status']): string {
  switch (s) {
    case 'running': return 'text-[var(--accent)]';
    case 'done': return 'text-[var(--meta)]';
    case 'error': return 'text-[var(--red)]';
    default: return 'text-[var(--meta)]';
  }
}

export function WriterConsoleFab() {
  const mutex = useRewriteMutex();
  const [open, setOpen] = useState(false);

  const hasAny = mutex.runs.length > 0;
  const runningCount = mutex.runs.filter((r) => r.status === 'running').length;
  const erroredCount = mutex.runs.filter((r) => r.status === 'error').length;

  const dotVisible = hasAny && (runningCount > 0 || erroredCount > 0);
  const dotClass = erroredCount > 0
    ? 'bg-[var(--red)]'
    : runningCount > 0
      ? 'bg-[var(--accent)] animate-pulse'
      : 'bg-[var(--accent)]';
  const borderClass = erroredCount > 0
    ? 'border-[var(--red)]'
    : runningCount > 0
      ? 'border-[var(--accent-soft,var(--accent))]'
      : 'border-[var(--hair)]';

  if (!hasAny && !open) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="writer-console-fab"
        aria-label="改写控制台"
        title={`改写控制台 · ${mutex.runs.length} 次运行`}
        className={`fixed bottom-5 right-5 z-40 group inline-flex items-center justify-center w-12 h-12 rounded-full border ${borderClass} bg-[var(--bg-1)] text-[var(--meta)] shadow-[0_4px_12px_rgba(0,0,0,0.12)] hover:border-[var(--accent-soft,var(--accent))] hover:bg-[var(--bg-2)] hover:text-[var(--accent)] transition-colors`}
      >
        <TerminalIcon />
        {dotVisible && (
          <span className={`absolute top-1 right-1 w-2.5 h-2.5 rounded-full ${dotClass}`} aria-hidden />
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="改写控制台"
          className="fixed inset-0 z-50 flex flex-col bg-[var(--bg-0,var(--bg-1))]"
        >
          <header className="flex items-center justify-between px-6 h-12 border-b border-[var(--hair)] bg-[var(--bg-1)]">
            <div className="flex items-center gap-3">
              <h1 className="text-sm font-semibold text-[var(--heading)]">改写控制台</h1>
              <span className="text-xs text-[var(--meta)]">{mutex.runs.length} 次运行</span>
            </div>
            <div className="flex items-center gap-2">
              {mutex.runs.some((r) => r.status !== 'running') && (
                <button
                  type="button"
                  onClick={() => mutex.clearRuns()}
                  className="text-xs text-[var(--meta)] hover:text-[var(--heading)] px-2 py-1"
                >
                  清空已完成
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="关闭"
                className="w-7 h-7 flex items-center justify-center rounded text-[var(--meta)] hover:text-[var(--heading)] hover:bg-[var(--bg-2)]"
              >
                ✕
              </button>
            </div>
          </header>

          <div className="flex-1 overflow-auto p-6 space-y-6">
            {mutex.runs.length === 0 ? (
              <div className="text-sm text-[var(--meta)] italic">暂无改写活动。</div>
            ) : (
              mutex.runs.map((run) => (
                <section
                  key={`${run.sectionKey}-${run.startedAt}`}
                  className="rounded border border-[var(--hair)] bg-[var(--bg-1)] overflow-hidden"
                >
                  <header className="flex items-center justify-between px-4 h-10 border-b border-[var(--hair)] text-xs">
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-[var(--heading)]">{run.label}</span>
                      <span className={statusClasses(run.status)}>{statusLabel(run.status)}</span>
                      <span className="text-[var(--faint)]">{formatDuration(run)}</span>
                    </div>
                    <span className="text-[var(--faint)]" style={{ fontFamily: 'var(--font-mono)' }}>
                      {run.sectionKey}
                    </span>
                  </header>
                  <div className="p-4 bg-[var(--bg-2)]">
                    <ToolTimeline events={run.timeline} />
                  </div>
                </section>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
}

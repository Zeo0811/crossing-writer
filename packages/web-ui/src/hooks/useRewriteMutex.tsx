import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import type { TimelineEvent } from '../components/writer/ToolTimeline.js';

export type RewriteStatus = 'idle' | 'running' | 'done' | 'error';

export interface RewriteConsoleRun {
  sectionKey: string;
  label: string;
  status: RewriteStatus;
  startedAt: number;
  timeline: TimelineEvent[];
}

export interface RewriteMutex {
  activeKey: string | null;
  acquire(key: string): boolean;
  release(key: string): void;
  // Console / FAB state (global view of all rewrite activity)
  runs: RewriteConsoleRun[];
  startRun(sectionKey: string, label: string): void;
  appendTimeline(sectionKey: string, event: TimelineEvent): void;
  finishRun(sectionKey: string, status: Exclude<RewriteStatus, 'idle' | 'running'>): void;
  clearRuns(): void;
}

const RewriteMutexContext = createContext<RewriteMutex | null>(null);

export function RewriteMutexProvider({ children }: { children: ReactNode }) {
  const activeRef = useRef<string | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [runs, setRuns] = useState<RewriteConsoleRun[]>([]);

  const acquire = useCallback((key: string): boolean => {
    if (activeRef.current !== null && activeRef.current !== key) {
      return false;
    }
    activeRef.current = key;
    setActiveKey(key);
    return true;
  }, []);

  const release = useCallback((key: string): void => {
    if (activeRef.current === key) {
      activeRef.current = null;
      setActiveKey(null);
    }
  }, []);

  const startRun = useCallback((sectionKey: string, label: string) => {
    setRuns((prev) => {
      // If an existing run for this section is still running, reset its timeline.
      const idx = prev.findIndex((r) => r.sectionKey === sectionKey);
      const fresh: RewriteConsoleRun = {
        sectionKey, label, status: 'running', startedAt: Date.now(), timeline: [],
      };
      if (idx === -1) return [...prev, fresh];
      const next = prev.slice();
      next[idx] = fresh;
      return next;
    });
  }, []);

  const appendTimeline = useCallback((sectionKey: string, event: TimelineEvent) => {
    setRuns((prev) => prev.map((r) =>
      r.sectionKey === sectionKey ? { ...r, timeline: [...r.timeline, event] } : r,
    ));
  }, []);

  const finishRun = useCallback((sectionKey: string, status: Exclude<RewriteStatus, 'idle' | 'running'>) => {
    setRuns((prev) => prev.map((r) =>
      r.sectionKey === sectionKey ? { ...r, status } : r,
    ));
  }, []);

  const clearRuns = useCallback(() => {
    setRuns((prev) => prev.filter((r) => r.status === 'running'));
  }, []);

  return (
    <RewriteMutexContext.Provider value={{
      activeKey, acquire, release,
      runs, startRun, appendTimeline, finishRun, clearRuns,
    }}>
      {children}
    </RewriteMutexContext.Provider>
  );
}

export function useRewriteMutex(): RewriteMutex {
  const ctx = useContext(RewriteMutexContext);
  if (!ctx) {
    throw new Error('useRewriteMutex must be used within RewriteMutexProvider');
  }
  return ctx;
}

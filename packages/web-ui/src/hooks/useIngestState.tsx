import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import type { IngestStreamEvent, IngestStartArgs } from "../api/wiki-client";
import { startIngestStream } from "../api/wiki-client";

export type IngestStatus = "idle" | "running" | "done" | "error";

interface IngestState {
  status: IngestStatus;
  events: IngestStreamEvent[];
  error: string | null;
  runningCount: number;
  /** Sliding-window queue depth: tasks waiting for an in-flight slot. */
  queuedCount: number;
  /** Increments every time a run finishes (success or error). Use as a refetch trigger. */
  completedSeq: number;
  start: (args: IngestStartArgs) => void;
  /** Fire N payloads with a sliding window, at most maxInFlight active at a time. */
  startQueue: (payloads: IngestStartArgs[], maxInFlight: number) => void;
  dismiss: () => void;
}

const Ctx = createContext<IngestState | null>(null);

export function IngestProvider({ children }: { children: ReactNode }) {
  const [events, setEvents] = useState<IngestStreamEvent[]>([]);
  const [runningCount, setRunningCount] = useState(0);
  const [queuedCount, setQueuedCount] = useState(0);
  const [hasCompleted, setHasCompleted] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [completedSeq, setCompletedSeq] = useState(0);
  // Queue state for startQueue — kept in refs so we don't re-trigger renders
  // every time a slot frees up. The UI only needs queuedCount, which follows.
  const queueRef = useRef<IngestStartArgs[]>([]);
  const maxInFlightRef = useRef(1);
  const inFlightRef = useRef(0);

  const status: IngestStatus =
    runningCount > 0 ? "running" :
    lastError ? "error" :
    hasCompleted ? "done" : "idle";

  const launchOne = useCallback((args: IngestStartArgs, onDone?: () => void) => {
    setRunningCount((c) => c + 1);
    setLastError(null);
    startIngestStream(
      args,
      (e) => setEvents((prev) => [...prev, { ...e, receivedAt: new Date().toISOString() }]),
      () => {
        setRunningCount((c) => c - 1);
        setHasCompleted(true);
        setCompletedSeq((s) => s + 1);
        onDone?.();
      },
      (err) => {
        setRunningCount((c) => c - 1);
        setLastError(err);
        setCompletedSeq((s) => s + 1);
        onDone?.();
      },
    );
  }, []);

  const start = useCallback((args: IngestStartArgs) => {
    launchOne(args);
  }, [launchOne]);

  const pumpQueue = useCallback(() => {
    while (inFlightRef.current < maxInFlightRef.current && queueRef.current.length > 0) {
      const next = queueRef.current.shift()!;
      inFlightRef.current += 1;
      setQueuedCount(queueRef.current.length);
      launchOne(next, () => {
        inFlightRef.current -= 1;
        pumpQueue();
      });
    }
  }, [launchOne]);

  const startQueue = useCallback((payloads: IngestStartArgs[], maxInFlight: number) => {
    if (payloads.length === 0) return;
    maxInFlightRef.current = Math.max(1, maxInFlight);
    queueRef.current = [...queueRef.current, ...payloads];
    setQueuedCount(queueRef.current.length);
    pumpQueue();
  }, [pumpQueue]);

  const dismiss = useCallback(() => {
    if (runningCount === 0) {
      setEvents([]);
      setLastError(null);
      setHasCompleted(false);
    }
  }, [runningCount]);

  return (
    <Ctx.Provider value={{ status, events, error: lastError, runningCount, queuedCount, completedSeq, start, startQueue, dismiss }}>
      {children}
    </Ctx.Provider>
  );
}

export function useIngestState(): IngestState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useIngestState must be inside IngestProvider");
  return ctx;
}

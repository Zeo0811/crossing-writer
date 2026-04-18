import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
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
  /** Drop the unlaunched tail of the queue. In-flight runs keep going. */
  clearQueue: () => void;
  dismiss: () => void;
}

const Ctx = createContext<IngestState | null>(null);

// Persist the *unlaunched* queue so a page refresh doesn't silently drop
// payloads the user has already scheduled. Only pending payloads are kept —
// anything already POSTed to the server continues server-side regardless.
const QUEUE_STORAGE_KEY = "crossing.ingestQueue.v1";

interface PersistedQueue {
  payloads: IngestStartArgs[];
  maxInFlight: number;
}

function readPersistedQueue(): PersistedQueue | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(QUEUE_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as PersistedQueue;
    if (!Array.isArray(data?.payloads) || data.payloads.length === 0) return null;
    return {
      payloads: data.payloads,
      maxInFlight: Math.max(1, Number(data.maxInFlight) || 1),
    };
  } catch {
    return null;
  }
}

function writePersistedQueue(payloads: IngestStartArgs[], maxInFlight: number) {
  if (typeof window === "undefined") return;
  try {
    if (payloads.length === 0) {
      window.localStorage.removeItem(QUEUE_STORAGE_KEY);
    } else {
      window.localStorage.setItem(
        QUEUE_STORAGE_KEY,
        JSON.stringify({ payloads, maxInFlight } as PersistedQueue),
      );
    }
  } catch {
    /* storage unavailable, silently drop */
  }
}

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

  const persistCurrent = useCallback(() => {
    writePersistedQueue(queueRef.current, maxInFlightRef.current);
  }, []);

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
      persistCurrent();
      launchOne(next, () => {
        inFlightRef.current -= 1;
        pumpQueue();
      });
    }
  }, [launchOne, persistCurrent]);

  const startQueue = useCallback((payloads: IngestStartArgs[], maxInFlight: number) => {
    if (payloads.length === 0) return;
    maxInFlightRef.current = Math.max(1, maxInFlight);
    queueRef.current = [...queueRef.current, ...payloads];
    setQueuedCount(queueRef.current.length);
    persistCurrent();
    pumpQueue();
  }, [pumpQueue, persistCurrent]);

  const clearQueue = useCallback(() => {
    queueRef.current = [];
    setQueuedCount(0);
    persistCurrent();
  }, [persistCurrent]);

  const dismiss = useCallback(() => {
    if (runningCount === 0) {
      setEvents([]);
      setLastError(null);
      setHasCompleted(false);
    }
  }, [runningCount]);

  // On mount: if a page refresh happened with unlaunched payloads still
  // queued, resume them. Runs that were in flight before the refresh
  // continue server-side and show up in the 历史记录 tab on their own.
  useEffect(() => {
    const persisted = readPersistedQueue();
    if (!persisted) return;
    maxInFlightRef.current = persisted.maxInFlight;
    queueRef.current = persisted.payloads;
    setQueuedCount(queueRef.current.length);
    pumpQueue();
    // only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Ctx.Provider value={{ status, events, error: lastError, runningCount, queuedCount, completedSeq, start, startQueue, clearQueue, dismiss }}>
      {children}
    </Ctx.Provider>
  );
}

export function useIngestState(): IngestState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useIngestState must be inside IngestProvider");
  return ctx;
}

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import type { IngestStreamEvent, IngestStartArgs } from "../api/wiki-client";
import { startIngestStream } from "../api/wiki-client";

export type IngestStatus = "idle" | "running" | "done" | "error";

interface IngestState {
  status: IngestStatus;
  events: IngestStreamEvent[];
  error: string | null;
  runningCount: number;
  start: (args: IngestStartArgs) => void;
  dismiss: () => void;
}

const Ctx = createContext<IngestState | null>(null);

export function IngestProvider({ children }: { children: ReactNode }) {
  const [events, setEvents] = useState<IngestStreamEvent[]>([]);
  const [runningCount, setRunningCount] = useState(0);
  const [hasCompleted, setHasCompleted] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const status: IngestStatus =
    runningCount > 0 ? "running" :
    lastError ? "error" :
    hasCompleted ? "done" : "idle";

  const start = useCallback((args: IngestStartArgs) => {
    setRunningCount((c) => c + 1);
    setLastError(null);
    startIngestStream(
      args,
      (e) => setEvents((prev) => [...prev, { ...e, receivedAt: new Date().toISOString() }]),
      () => {
        setRunningCount((c) => c - 1);
        setHasCompleted(true);
      },
      (err) => {
        setRunningCount((c) => c - 1);
        setLastError(err);
      },
    );
  }, []);

  const dismiss = useCallback(() => {
    if (runningCount === 0) {
      setEvents([]);
      setLastError(null);
      setHasCompleted(false);
    }
  }, [runningCount]);

  return (
    <Ctx.Provider value={{ status, events, error: lastError, runningCount, start, dismiss }}>
      {children}
    </Ctx.Provider>
  );
}

export function useIngestState(): IngestState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useIngestState must be inside IngestProvider");
  return ctx;
}

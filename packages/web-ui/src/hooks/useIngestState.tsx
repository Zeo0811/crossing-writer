import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import type { IngestStreamEvent, IngestStartArgs } from "../api/wiki-client";
import { startIngestStream, getPages, status as wikiStatus } from "../api/wiki-client";

export type IngestStatus = "idle" | "running" | "done" | "error";

interface IngestState {
  status: IngestStatus;
  events: IngestStreamEvent[];
  error: string | null;
  start: (args: IngestStartArgs) => void;
  dismiss: () => void;
}

const Ctx = createContext<IngestState | null>(null);

export function IngestProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<IngestStatus>("idle");
  const [events, setEvents] = useState<IngestStreamEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const runningRef = useRef(false);

  const start = useCallback((args: IngestStartArgs) => {
    if (runningRef.current) return;
    runningRef.current = true;
    setEvents([]);
    setStatus("running");
    setError(null);
    startIngestStream(
      args,
      (e) => setEvents((prev) => [...prev, { ...e, receivedAt: new Date().toISOString() }]),
      () => {
        setStatus("done");
        runningRef.current = false;
      },
      (err) => {
        setStatus("error");
        setError(err);
        runningRef.current = false;
      },
    );
  }, []);

  const dismiss = useCallback(() => {
    if (status !== "running") {
      setStatus("idle");
      setEvents([]);
      setError(null);
    }
  }, [status]);

  return (
    <Ctx.Provider value={{ status, events, error, start, dismiss }}>
      {children}
    </Ctx.Provider>
  );
}

export function useIngestState(): IngestState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useIngestState must be inside IngestProvider");
  return ctx;
}

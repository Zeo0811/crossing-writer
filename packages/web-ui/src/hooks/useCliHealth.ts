import { useEffect, useRef, useState } from "react";
import * as api from "../api/system-health";
import type { CliHealthResponse } from "../api/system-health";

export interface UseCliHealthResult {
  data: CliHealthResponse | null;
  loading: boolean;
  error: Error | null;
}

const POLL_INTERVAL_MS = 30_000;

export function useCliHealth(): UseCliHealthResult {
  const [data, setData] = useState<CliHealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const run = async () => {
      try {
        const res = await api.fetchCliHealth();
        if (!mountedRef.current) return;
        setData(res);
        setError(null);
      } catch (err) {
        if (!mountedRef.current) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    };
    void run();
    const id = setInterval(() => {
      void run();
    }, POLL_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, []);

  return { data, loading, error };
}

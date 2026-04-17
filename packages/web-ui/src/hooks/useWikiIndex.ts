import { useEffect, useState } from "react";
import { getWikiIndex, type WikiIndexEntry } from "../api/wiki-client";

interface CacheShape {
  entries: WikiIndexEntry[];
  ts: number;
}

let cache: CacheShape | null = null;
let inflight: Promise<WikiIndexEntry[]> | null = null;
const TTL_MS = 60_000;

export function __resetWikiIndexCache(): void {
  cache = null;
  inflight = null;
}

async function load(): Promise<WikiIndexEntry[]> {
  if (cache && Date.now() - cache.ts < TTL_MS) return cache.entries;
  if (inflight) return inflight;
  inflight = getWikiIndex()
    .then((entries) => {
      cache = { entries, ts: Date.now() };
      inflight = null;
      return entries;
    })
    .catch((err) => {
      inflight = null;
      throw err;
    });
  return inflight;
}

export function useWikiIndex(): { entries: WikiIndexEntry[]; loading: boolean; error: string | null } {
  const [entries, setEntries] = useState<WikiIndexEntry[]>(() => cache?.entries ?? []);
  const [loading, setLoading] = useState<boolean>(!cache);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load()
      .then((es) => { if (!cancelled) { setEntries(es); setError(null); } })
      .catch((e) => { if (!cancelled) setError((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return { entries, loading, error };
}

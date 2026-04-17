import { useCallback, useMemo, useState } from "react";

export interface CartEntry {
  articleId: string;
  account: string;
  title: string;
  publishedAt: string;
  wordCount: number | null;
}

export interface UseIngestCartInput {
  maxArticles: number;
}

export interface UseIngestCartReturn {
  entries: CartEntry[];
  totalCount: number;
  perAccountCount: Map<string, number>;
  exceedsMax: boolean;
  has: (articleId: string) => boolean;
  toggle: (entry: CartEntry) => void;
  remove: (articleId: string) => void;
  addMany: (entries: CartEntry[]) => void;
  removeMany: (articleIds: string[]) => void;
  clear: () => void;
}

export function useIngestCart({ maxArticles }: UseIngestCartInput): UseIngestCartReturn {
  const [entries, setEntries] = useState<CartEntry[]>([]);

  const idSet = useMemo(() => new Set(entries.map((e) => e.articleId)), [entries]);
  const perAccountCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries) m.set(e.account, (m.get(e.account) ?? 0) + 1);
    return m;
  }, [entries]);

  const has = useCallback((id: string) => idSet.has(id), [idSet]);
  const toggle = useCallback((entry: CartEntry) => {
    setEntries((prev) => prev.some((e) => e.articleId === entry.articleId)
      ? prev.filter((e) => e.articleId !== entry.articleId)
      : [...prev, entry]);
  }, []);
  const remove = useCallback((id: string) => {
    setEntries((prev) => prev.filter((e) => e.articleId !== id));
  }, []);
  const addMany = useCallback((toAdd: CartEntry[]) => {
    setEntries((prev) => {
      const existing = new Set(prev.map((e) => e.articleId));
      return [...prev, ...toAdd.filter((e) => !existing.has(e.articleId))];
    });
  }, []);
  const removeMany = useCallback((ids: string[]) => {
    const s = new Set(ids);
    setEntries((prev) => prev.filter((e) => !s.has(e.articleId)));
  }, []);
  const clear = useCallback(() => setEntries([]), []);

  return {
    entries,
    totalCount: entries.length,
    perAccountCount,
    exceedsMax: entries.length > maxArticles,
    has, toggle, remove, addMany, removeMany, clear,
  };
}

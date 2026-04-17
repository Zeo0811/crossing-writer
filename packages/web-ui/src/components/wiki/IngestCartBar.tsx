import type { CartEntry } from "../../hooks/useIngestCart";
import { Button, Chip } from "../ui";

export interface IngestCartBarProps {
  entries: CartEntry[];
  maxArticles: number;
  onClear: () => void;
  onSubmit: () => void;
}

export function IngestCartBar({ entries, maxArticles, onClear, onSubmit }: IngestCartBarProps) {
  const totalCount = entries.length;
  const exceedsMax = totalCount > maxArticles;
  const totalWords = entries.reduce((s, e) => s + (e.wordCount ?? 0), 0);
  const perAccount = new Map<string, number>();
  for (const e of entries) perAccount.set(e.account, (perAccount.get(e.account) ?? 0) + 1);

  const breakdown = Array.from(perAccount.entries()).map(([a, n]) => `${a} ${n}`).join(" · ");

  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded border ${
      exceedsMax ? "border-[var(--red)] bg-[rgba(255,107,107,0.05)]" : "border-[var(--accent-soft)] bg-[var(--bg-1)]"
    }`}>
      <Chip variant={exceedsMax ? "red" : "accent"} size="sm">已选 {totalCount} 篇</Chip>
      {breakdown && <span className="text-xs text-[var(--meta)]">{breakdown} · 约 {totalWords} 字</span>}
      {exceedsMax && <span className="text-xs text-[var(--red)]">超上限 {maxArticles}</span>}
      <span className="flex-1" />
      <Button variant="ghost" size="sm" onClick={onClear} disabled={totalCount === 0}>清空</Button>
      <Button variant="primary" size="md" onClick={onSubmit} disabled={totalCount === 0 || exceedsMax}>入库 →</Button>
    </div>
  );
}

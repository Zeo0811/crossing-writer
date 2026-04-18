import type { CartEntry } from "../../hooks/useIngestCart";
import { Button, Chip } from "../ui";

export interface IngestCartBarProps {
  entries: CartEntry[];
  onClear: () => void;
  onSubmit: () => void;
}

// Under batch_size=1 + sliding-window concurrency there's no batch
// context explosion to guard against anymore. A click on 500 articles
// just means 500 independent single-article runs, paced by the
// concurrency ceiling set in the confirm dialog. Rather than refuse
// the submission, we only show a soft hint above this threshold so a
// genuine misclick (e.g. 2000 articles) is visually obvious.
const SOFT_WARNING_AT = 100;

export function IngestCartBar({ entries, onClear, onSubmit }: IngestCartBarProps) {
  const totalCount = entries.length;
  const totalWords = entries.reduce((s, e) => s + (e.wordCount ?? 0), 0);
  const perAccount = new Map<string, number>();
  for (const e of entries) perAccount.set(e.account, (perAccount.get(e.account) ?? 0) + 1);

  const breakdown = Array.from(perAccount.entries()).map(([a, n]) => `${a} ${n}`).join(" · ");
  const large = totalCount >= SOFT_WARNING_AT;

  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded border ${
      large ? "border-[var(--amber)] bg-[rgba(255,176,77,0.05)]" : "border-[var(--accent-soft)] bg-[var(--bg-1)]"
    }`}>
      <Chip variant={large ? "amber" : "accent"} size="sm">已选 {totalCount} 篇</Chip>
      {breakdown && <span className="text-xs text-[var(--meta)]">{breakdown} · 约 {totalWords} 字</span>}
      {large && <span className="text-xs text-[var(--amber)]">大批量，注意配额</span>}
      <span className="flex-1" />
      <Button variant="ghost" size="sm" onClick={onClear} disabled={totalCount === 0}>清空</Button>
      <Button variant="primary" size="md" onClick={onSubmit} disabled={totalCount === 0}>入库 →</Button>
    </div>
  );
}

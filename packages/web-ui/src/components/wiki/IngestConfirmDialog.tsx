import { useEffect, useState } from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import { Dialog, DialogContent, Button } from "../ui";
import { checkDuplicates, type DupCheckResult, type IngestStartArgs } from "../../api/wiki-client";
import type { CartEntry } from "../../hooks/useIngestCart";

export interface IngestConfirmDialogProps {
  open: boolean;
  entries: CartEntry[];
  model: { cli: "claude" | "codex"; model: string };
  onConfirm: (payload: IngestStartArgs, concurrency: number) => void;
  onCancel: () => void;
}

const CONCURRENCY_OPTIONS = [1, 3, 5, 8, 10];

export function IngestConfirmDialog({ open, entries, model, onConfirm, onCancel }: IngestConfirmDialogProps) {
  const [dup, setDup] = useState<DupCheckResult | null>(null);
  const [force, setForce] = useState(false);
  const [loading, setLoading] = useState(false);
  const [concurrency, setConcurrency] = useState(5);

  useEffect(() => {
    if (!open || entries.length === 0) return;
    let cancelled = false;
    setLoading(true);
    setForce(false);
    checkDuplicates(entries.map((e) => e.articleId))
      .then((r) => { if (!cancelled) setDup(r); })
      .catch(() => { if (!cancelled) setDup({ already_ingested: [], fresh: entries.map((e) => e.articleId) }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, entries]);

  const alreadyCount = dup?.already_ingested.length ?? 0;
  const targetIds = force ? entries.map((e) => e.articleId) : (dup?.fresh ?? []);
  // Each article is its own run (batch_size=1). Concurrency caps
  // how many run at the same time.
  const effectiveConcurrency = Math.max(1, Math.min(concurrency, targetIds.length));

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent width={400} aria-describedby={undefined}>
        <div className="px-5 py-4 space-y-3">
          <RadixDialog.Title className="text-sm font-semibold text-[var(--heading)] m-0">
            入库 {targetIds.length} 篇？
          </RadixDialog.Title>
          <div className="text-xs text-[var(--meta)] font-mono">{model.cli}/{model.model}</div>
          {loading && <div className="text-xs text-[var(--faint)]">检查去重中…</div>}
          {!loading && alreadyCount > 0 && (
            <label className="flex items-center gap-2 text-xs text-[var(--amber)] cursor-pointer">
              <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
              <span>其中 {alreadyCount} 篇已入过库，{force ? "将重新入库" : "跳过"}</span>
            </label>
          )}
          <div className="flex items-center gap-2 text-xs text-[var(--body)] pt-1">
            <span className="text-[var(--meta)]">并发</span>
            <div className="inline-flex items-center gap-0.5 p-0.5 rounded border border-[var(--hair)]">
              {CONCURRENCY_OPTIONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setConcurrency(n)}
                  className={`px-2 py-0.5 text-xs rounded ${
                    concurrency === n
                      ? "bg-[var(--accent-fill)] text-[var(--accent)] font-semibold"
                      : "text-[var(--meta)] hover:text-[var(--heading)] hover:bg-[var(--bg-2)]"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            {targetIds.length > 0 && (
              <span className="text-[var(--faint)] text-[10px]">
                {effectiveConcurrency === 1
                  ? `${targetIds.length} 篇串行`
                  : `${targetIds.length} 篇 · 同时跑 ${effectiveConcurrency} 个`}
              </span>
            )}
          </div>
        </div>
        <div className="px-5 py-3 border-t border-[var(--hair)] flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>取消</Button>
          <Button
            variant="primary"
            size="sm"
            disabled={loading || targetIds.length === 0}
            onClick={() => onConfirm({
              accounts: [],
              article_ids: targetIds,
              per_account_limit: 50,
              batch_size: 1,
              mode: "selected",
              cli_model: model,
              force_reingest: force,
              max_articles: Math.max(entries.length, 50),
            }, effectiveConcurrency)}
          >
            确认
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

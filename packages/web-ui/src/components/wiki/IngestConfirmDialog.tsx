import { useEffect, useState } from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import { Dialog, DialogContent, Button, Chip } from "../ui";
import { checkDuplicates, type DupCheckResult, type IngestStartArgs } from "../../api/wiki-client";
import type { CartEntry } from "../../hooks/useIngestCart";

export interface IngestConfirmDialogProps {
  open: boolean;
  entries: CartEntry[];
  model: { cli: "claude" | "codex"; model: string };
  onConfirm: (payload: IngestStartArgs) => void;
  onCancel: () => void;
}

export function IngestConfirmDialog({ open, entries, model, onConfirm, onCancel }: IngestConfirmDialogProps) {
  const [dup, setDup] = useState<DupCheckResult | null>(null);
  const [force, setForce] = useState(false);
  const [loading, setLoading] = useState(false);

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

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent width={520} aria-describedby={undefined}>
        <div className="px-5 pt-4 pb-2 border-b border-[var(--hair)]">
          <RadixDialog.Title className="text-base font-semibold text-[var(--heading)] m-0">入库确认</RadixDialog.Title>
          <p className="text-xs text-[var(--meta)] mt-1">{entries.length} 篇 · 模型 {model.cli}/{model.model}</p>
        </div>
        <div className="px-5 py-4 space-y-3 max-h-[60vh] overflow-auto">
          {loading && <div className="text-xs text-[var(--meta)]">检查去重中…</div>}
          {!loading && dup && (
            <>
              {alreadyCount > 0 && (
                <div className="rounded bg-[var(--amber-bg)] border border-[var(--amber-hair)] p-3 space-y-2">
                  <div className="text-xs text-[var(--amber)]">
                    其中 <strong>{alreadyCount} 篇</strong>已入过库
                  </div>
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
                    <span>重新入库（覆盖已有 source）</span>
                  </label>
                </div>
              )}
              <div className="text-xs text-[var(--body)]">
                将处理 <Chip variant="accent" size="sm">{targetIds.length} 篇</Chip>
                {!force && alreadyCount > 0 && <span className="text-[var(--faint)]"> （跳过 {alreadyCount} 篇已入库）</span>}
              </div>
            </>
          )}
        </div>
        <div className="px-5 py-3 border-t border-[var(--hair)] flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>取消</Button>
          <Button
            variant="primary"
            disabled={loading || targetIds.length === 0}
            onClick={() => onConfirm({
              accounts: [],
              article_ids: targetIds,
              per_account_limit: 50,
              batch_size: 5,
              mode: "selected",
              cli_model: model,
              force_reingest: force,
              max_articles: Math.max(entries.length, 50),
            })}
          >
            确认入库
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

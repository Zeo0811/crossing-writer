import { useEffect, useMemo, useState } from "react";
import { AccountSidebar } from "./AccountSidebar";
import { AccountGrid } from "./AccountGrid";
import { AccountHeatmap } from "./AccountHeatmap";
import { ArticleList, type ArticleListItem } from "./ArticleList";
import { IngestCartBar } from "./IngestCartBar";
import { IngestConfirmDialog } from "./IngestConfirmDialog";
import { type CartEntry, type UseIngestCartReturn } from "../../hooks/useIngestCart";
import { useIngestState } from "../../hooks/useIngestState";
import { Input } from "../ui";
import type { IngestStartArgs } from "../../api/wiki-client";

interface AccountStat {
  account: string;
  count: number;
  ingested_count: number;
  earliest_published_at: string;
  latest_published_at: string;
}

export interface IngestTabProps {
  model: { cli: "claude" | "codex"; model: string };
  cart: UseIngestCartReturn;
}


export function IngestTab({ model, cart }: IngestTabProps) {
  const [accounts, setAccounts] = useState<AccountStat[]>([]);
  const [activeAccount, setActiveAccount] = useState<string | null>(null);
  const [articles, setArticles] = useState<ArticleListItem[]>([]);
  const [search, setSearch] = useState("");
  const [heatmapDates, setHeatmapDates] = useState<Set<string>>(() => new Set());
  const [showConfirm, setShowConfirm] = useState(false);
  const ingest = useIngestState();

  useEffect(() => {
    void fetch("/api/kb/accounts").then(async (r) => {
      if (r.ok) setAccounts(await r.json());
    }).catch(() => {});
  }, [ingest.completedSeq]);

  useEffect(() => {
    setHeatmapDates(new Set());
    if (!activeAccount) { setArticles([]); return; }
    void fetch(`/api/kb/accounts/${encodeURIComponent(activeAccount)}/articles?limit=3000`).then(async (r) => {
      if (r.ok) setArticles(await r.json());
    }).catch(() => {});
  }, [activeAccount]);

  // Refetch articles when any run completes (so ArticleList status + heatmap grid refresh)
  useEffect(() => {
    if (!activeAccount || ingest.completedSeq === 0) return;
    void fetch(`/api/kb/accounts/${encodeURIComponent(activeAccount)}/articles?limit=3000`).then(async (r) => {
      if (r.ok) setArticles(await r.json());
    }).catch(() => {});
  }, [ingest.completedSeq, activeAccount]);

  const visibleArticles = useMemo(() => {
    let list = articles;
    if (heatmapDates.size > 0) {
      list = list.filter((a) => heatmapDates.has(a.published_at.slice(0, 10)));
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((a) => a.title.toLowerCase().includes(q));
    }
    return list;
  }, [articles, search, heatmapDates]);

  // Mark articles whose ingest_status indicates they've already been
  // written to the wiki (either via the legacy tag pipeline or via the
  // new wiki_ingest_marks table — the server promotes marks into a
  // "wiki_marked" status value for this purpose). These rows render as
  // disabled in ArticleList and are excluded from the "全选 N 篇" count.
  const duplicates = useMemo(() => {
    const s = new Set<string>();
    for (const a of articles) {
      if (a.ingest_status !== "raw" && a.ingest_status !== "tag_failed") {
        s.add(a.id);
      }
    }
    return s;
  }, [articles]);
  const selectedIds = useMemo(() => new Set(cart.entries.map((e) => e.articleId)), [cart.entries]);

  function toggleArticle(articleId: string) {
    const a = articles.find((x) => x.id === articleId);
    if (!a || !activeAccount) return;
    const entry: CartEntry = {
      articleId: a.id, account: activeAccount, title: a.title,
      publishedAt: a.published_at, wordCount: a.word_count,
    };
    cart.toggle(entry);
  }

  const selectableVisible = useMemo(
    () => visibleArticles.filter((a) => !duplicates.has(a.id)),
    [visibleArticles, duplicates],
  );
  const allVisibleSelected =
    selectableVisible.length > 0 && selectableVisible.every((a) => selectedIds.has(a.id));

  function toggleSelectAll() {
    if (!activeAccount || selectableVisible.length === 0) return;
    if (allVisibleSelected) {
      cart.removeMany(selectableVisible.map((a) => a.id));
    } else {
      cart.addMany(selectableVisible.map((a) => ({
        articleId: a.id, account: activeAccount, title: a.title,
        publishedAt: a.published_at, wordCount: a.word_count,
      })));
    }
  }

  function handleConfirm(payload: IngestStartArgs, concurrency: number) {
    setShowConfirm(false);
    const ids = payload.article_ids ?? [];
    // One run per article. Concurrency caps how many run at once.
    // Each single-article payload only ever projects 1 article, so
    // omit max_articles and let the backend's default-of-1-per-request
    // validation handle it.
    const payloads: IngestStartArgs[] = ids.map((id) => ({
      ...payload,
      article_ids: [id],
      max_articles: 1,
    }));
    ingest.startQueue(payloads, concurrency);
    cart.clear();
  }

  const showGrid = activeAccount === null;

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
      <div className="shrink-0">
        <IngestCartBar
          entries={cart.entries}
          onClear={cart.clear}
          onSubmit={() => setShowConfirm(true)}
        />
      </div>
      {showGrid ? (
        <div className="flex-1 overflow-y-auto">
          <AccountGrid
            accounts={accounts}
            cartPerAccount={cart.perAccountCount}
            onSelect={setActiveAccount}
          />
        </div>
      ) : (
        <div className="flex gap-4 flex-1 min-h-0">
          <div className="w-[220px] shrink-0 overflow-y-auto">
            <AccountSidebar
              accounts={accounts}
              active={activeAccount}
              cartPerAccount={cart.perAccountCount}
              onSelect={setActiveAccount}
            />
          </div>
          <main className="flex-1 min-w-0 overflow-y-auto space-y-4">
            <div className="rounded bg-[var(--bg-2)] p-4">
              <div className="flex items-center gap-3 mb-3">
                <h2 className="text-sm font-semibold text-[var(--heading)]">{activeAccount}</h2>
                <span className="text-xs text-[var(--faint)]">
                  {accounts.find((a) => a.account === activeAccount)?.count ?? 0} 篇
                </span>
                <span className="flex-1" />
                <button
                  type="button"
                  onClick={() => setActiveAccount(null)}
                  aria-label="返回所有账号"
                  title="返回所有账号"
                  className="w-6 h-6 flex items-center justify-center rounded text-[var(--meta)] hover:text-[var(--heading)] hover:bg-[var(--bg-1)]"
                >
                  ✕
                </button>
              </div>
              <AccountHeatmap
                account={activeAccount}
                selectedDates={heatmapDates}
                onDateToggle={(d) => setHeatmapDates((prev) => {
                  const next = new Set(prev);
                  if (next.has(d)) next.delete(d); else next.add(d);
                  return next;
                })}
                onClearDates={() => setHeatmapDates(new Set())}
              />
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索该账号文章标题…"
                leftSlot="⌕"
                className="flex-1"
              />
              {heatmapDates.size > 0 && (
                <button
                  type="button"
                  onClick={() => setHeatmapDates(new Set())}
                  className="text-xs text-[var(--accent)] hover:underline px-2 py-1 rounded border border-[var(--accent-soft)] bg-[var(--accent-fill)] whitespace-nowrap"
                  title={Array.from(heatmapDates).sort().join(" · ")}
                >
                  {heatmapDates.size === 1 ? Array.from(heatmapDates)[0] : `${heatmapDates.size} 天`} 筛选中 ✕
                </button>
              )}
              {selectableVisible.length > 0 && (
                <button
                  type="button"
                  data-testid="select-all-visible"
                  onClick={toggleSelectAll}
                  className={`text-xs px-3 h-8 rounded border whitespace-nowrap shrink-0 ${
                    allVisibleSelected
                      ? "text-[var(--accent)] border-[var(--accent-soft)] bg-[var(--accent-fill)] hover:bg-[rgba(64,255,159,0.15)]"
                      : "text-[var(--body)] border-[var(--hair)] bg-[var(--bg-2)] hover:bg-[var(--bg-1)] hover:border-[var(--hair-strong)]"
                  }`}
                >
                  {allVisibleSelected ? `取消全选 ${selectableVisible.length}` : `全选 ${selectableVisible.length} 篇`}
                </button>
              )}
            </div>
            <ArticleList
              articles={visibleArticles}
              duplicates={duplicates}
              selectedIds={selectedIds}
              onToggle={toggleArticle}
            />
          </main>
        </div>
      )}

      <IngestConfirmDialog
        open={showConfirm}
        entries={cart.entries}
        model={model}
        onConfirm={handleConfirm}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  );
}

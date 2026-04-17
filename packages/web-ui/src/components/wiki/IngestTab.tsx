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

const MAX_ARTICLES = 50;

export function IngestTab({ model, cart }: IngestTabProps) {
  const [accounts, setAccounts] = useState<AccountStat[]>([]);
  const [activeAccount, setActiveAccount] = useState<string | null>(null);
  const [articles, setArticles] = useState<ArticleListItem[]>([]);
  const [search, setSearch] = useState("");
  const [heatmapDate, setHeatmapDate] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const ingest = useIngestState();

  useEffect(() => {
    void fetch("/api/kb/accounts").then(async (r) => {
      if (r.ok) setAccounts(await r.json());
    }).catch(() => {});
  }, []);

  useEffect(() => {
    setHeatmapDate(null);
    if (!activeAccount) { setArticles([]); return; }
    void fetch(`/api/kb/accounts/${encodeURIComponent(activeAccount)}/articles?limit=3000`).then(async (r) => {
      if (r.ok) setArticles(await r.json());
    }).catch(() => {});
  }, [activeAccount]);

  const visibleArticles = useMemo(() => {
    let list = articles;
    if (heatmapDate) {
      list = list.filter((a) => a.published_at.startsWith(heatmapDate));
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((a) => a.title.toLowerCase().includes(q));
    }
    return list;
  }, [articles, search, heatmapDate]);

  const duplicates = useMemo(() => new Set<string>(), []);
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

  function handleConfirm(payload: IngestStartArgs) {
    setShowConfirm(false);
    ingest.start(payload);
    cart.clear();
  }

  const showGrid = activeAccount === null;

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
      <div className="shrink-0">
        <IngestCartBar
          entries={cart.entries}
          maxArticles={MAX_ARTICLES}
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
                selectedDate={heatmapDate}
                onDateSelect={setHeatmapDate}
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
              {heatmapDate && (
                <button
                  type="button"
                  onClick={() => setHeatmapDate(null)}
                  className="text-xs text-[var(--accent)] hover:underline px-2 py-1 rounded border border-[var(--accent-soft)] bg-[var(--accent-fill)]"
                >
                  {heatmapDate} 筛选中 ✕
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

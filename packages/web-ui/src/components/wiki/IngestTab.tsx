import { useEffect, useMemo, useState } from "react";
import { AccountSidebar } from "./AccountSidebar";
import { AccountGrid } from "./AccountGrid";
import { AccountHeatmap } from "./AccountHeatmap";
import { ArticleList, type ArticleListItem } from "./ArticleList";
import { IngestCartBar } from "./IngestCartBar";
import { IngestConfirmDialog } from "./IngestConfirmDialog";
import { useIngestCart, type CartEntry } from "../../hooks/useIngestCart";
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
}

const MAX_ARTICLES = 50;

export function IngestTab({ model }: IngestTabProps) {
  const [accounts, setAccounts] = useState<AccountStat[]>([]);
  const [activeAccount, setActiveAccount] = useState<string | null>(null);
  const [articles, setArticles] = useState<ArticleListItem[]>([]);
  const [search, setSearch] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [quickAddLoading, setQuickAddLoading] = useState<string | null>(null);
  const cart = useIngestCart({ maxArticles: MAX_ARTICLES });
  const ingest = useIngestState();

  useEffect(() => {
    void fetch("/api/kb/accounts").then(async (r) => {
      if (r.ok) setAccounts(await r.json());
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!activeAccount) { setArticles([]); return; }
    void fetch(`/api/kb/accounts/${encodeURIComponent(activeAccount)}/articles?limit=3000`).then(async (r) => {
      if (r.ok) setArticles(await r.json());
    }).catch(() => {});
  }, [activeAccount]);

  const visibleArticles = useMemo(() => {
    if (!search) return articles;
    const q = search.toLowerCase();
    return articles.filter((a) => a.title.toLowerCase().includes(q));
  }, [articles, search]);

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

  function toggleFromHeatmap(articleId: string, title: string, publishedAt: string, wordCount: number | null) {
    if (!activeAccount) return;
    cart.toggle({ articleId, account: activeAccount, title, publishedAt, wordCount });
  }

  async function handleQuickAdd(account: string) {
    setQuickAddLoading(account);
    try {
      const r = await fetch(`/api/kb/accounts/${encodeURIComponent(account)}/articles?limit=3000`);
      if (!r.ok) return;
      const list = (await r.json()) as ArticleListItem[];
      const unIngested = list
        .filter((a) => a.ingest_status === "raw" || a.ingest_status === "tag_failed")
        .slice(0, MAX_ARTICLES);
      for (const a of unIngested) {
        if (!cart.has(a.id)) {
          cart.toggle({
            articleId: a.id, account, title: a.title,
            publishedAt: a.published_at, wordCount: a.word_count,
          });
        }
      }
    } finally {
      setQuickAddLoading(null);
    }
  }

  function handleConfirm(payload: IngestStartArgs) {
    setShowConfirm(false);
    ingest.start(payload);
    cart.clear();
  }

  const showGrid = activeAccount === null;

  return (
    <div className="flex flex-col gap-4">
      {showGrid ? (
        <AccountGrid
          accounts={accounts}
          cartPerAccount={cart.perAccountCount}
          onSelect={setActiveAccount}
          onQuickAdd={handleQuickAdd}
          quickAddLoading={quickAddLoading}
        />
      ) : (
        <div className="flex gap-4">
          <AccountSidebar
            accounts={accounts}
            active={activeAccount}
            cartPerAccount={cart.perAccountCount}
            onSelect={setActiveAccount}
          />
          <main className="flex-1 min-w-0 space-y-4">
            <div className="rounded bg-[var(--bg-2)] p-4 w-fit max-w-full">
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
              <AccountHeatmap account={activeAccount} onArticleClick={toggleFromHeatmap} />
            </div>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索该账号文章标题…"
              leftSlot="⌕"
            />
            <ArticleList
              articles={visibleArticles}
              duplicates={duplicates}
              selectedIds={selectedIds}
              onToggle={toggleArticle}
            />
          </main>
        </div>
      )}

      <IngestCartBar
        entries={cart.entries}
        maxArticles={MAX_ARTICLES}
        onClear={cart.clear}
        onSubmit={() => setShowConfirm(true)}
      />

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

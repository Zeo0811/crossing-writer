import { useEffect, useMemo, useState } from "react";
import { WikiPagePreview } from "../components/wiki/WikiPagePreview.js";
import { RawArticleDrawer } from "../components/wiki/RawArticleDrawer.js";
import { IngestTab } from "../components/wiki/IngestTab.js";
import { ModelSelector } from "../components/wiki/ModelSelector.js";
import { IngestConsoleFab } from "../components/wiki/IngestConsoleFab.js";
import { Input } from "../components/ui";
import { formatBeijingShort } from "../utils/time";
import { useIngestState } from "../hooks/useIngestState";
import { useIngestCart } from "../hooks/useIngestCart";
import {
  getPages,
  search as searchWikiApi,
  status as wikiStatus,
  type WikiPageMeta,
  type WikiSearchResult,
  type WikiStatus,
} from "../api/wiki-client.js";

const KIND_LABEL: Record<string, string> = {
  entity: "实体 entity",
  event: "事件 event",
  author: "作者 author",
  source: "来源 source",
  note: "笔记 note",
  concept: "概念 concept",
  case: "案例 case",
  observation: "观察 observation",
  person: "人物 person",
};

const MAX_ARTICLES = 50;

export function KnowledgePage() {
  const [mode, setMode] = useState<"browse" | "ingest">("browse");
  const [pages, setPages] = useState<WikiPageMeta[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [hits, setHits] = useState<WikiSearchResult[] | null>(null);
  const [q, setQ] = useState("");
  const [kindFilter, setKindFilter] = useState<string>("全部");
  const [statusInfo, setStatusInfo] = useState<WikiStatus | null>(null);
  const [drawerSource, setDrawerSource] = useState<{ account: string; articleId: string } | null>(null);
  const [model, setModel] = useState<{ cli: "claude" | "codex"; model: string }>({ cli: "claude", model: "sonnet" });

  const ingest = useIngestState();
  const cart = useIngestCart({ maxArticles: MAX_ARTICLES });

  useEffect(() => {
    void getPages().then(setPages).catch(() => setPages([]));
    void wikiStatus().then(setStatusInfo).catch(() => setStatusInfo(null));
  }, []);

  useEffect(() => {
    if (ingest.status === "done") {
      void getPages().then(setPages);
      void wikiStatus().then(setStatusInfo);
    }
  }, [ingest.status]);

  const kinds = useMemo(() => {
    const s = new Set<string>(pages.map((p) => p.kind));
    return ["全部", ...Array.from(s)];
  }, [pages]);

  const visible = useMemo(() => {
    if (hits) return [];
    return pages.filter((p) => {
      if (kindFilter !== "全部" && p.kind !== kindFilter) return false;
      if (q && !p.title.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [pages, hits, q, kindFilter]);

  function runSearch(query: string) {
    setQ(query);
    setSelected(null);
    if (!query.trim()) { setHits(null); return; }
    void searchWikiApi({ query, limit: 40 }).then(setHits).catch(() => setHits([]));
  }

  // Ingest button state: running > error > cart > idle
  const ingestButton = (() => {
    if (ingest.status === "running") {
      return {
        label: "入库",
        suffix: "运行中",
        tone: "amber" as const,
        dot: true,
      };
    }
    if (ingest.status === "error") {
      return { label: "入库", suffix: "失败", tone: "red" as const, dot: false };
    }
    if (cart.totalCount > 0) {
      return { label: "入库", suffix: `已选 ${cart.totalCount}`, tone: "accent" as const, dot: false };
    }
    return { label: "入库", suffix: null, tone: "neutral" as const, dot: false };
  })();

  const toneClass = {
    amber: "bg-[var(--amber)] text-[var(--bg-0)] border-[var(--amber)] shadow-[0_0_12px_rgba(255,209,102,0.35)]",
    red: "bg-[var(--red)] text-white border-[var(--red)] shadow-[0_0_12px_rgba(255,107,107,0.35)]",
    accent: "bg-[var(--accent)] text-[var(--accent-on)] border-[var(--accent-soft)] shadow-[0_0_12px_var(--accent-dim)]",
    neutral: "bg-[var(--bg-1)] text-[var(--body)] border-[var(--hair-strong)] hover:border-[var(--accent-soft)] hover:text-[var(--accent)]",
  }[ingestButton.tone];

  return (
    <div data-testid="page-knowledge" className="rounded border border-[var(--hair)] bg-[var(--bg-1)] overflow-hidden">
      <header className="flex items-center justify-between px-6 h-14 border-b border-[var(--hair)]">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-semibold text-[var(--heading)]">知识库</h1>
          <button
            type="button"
            data-testid="ingest-mode-toggle"
            onClick={() => setMode(mode === "browse" ? "ingest" : "browse")}
            className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full border text-sm font-semibold transition-all ${toneClass}`}
          >
            {ingestButton.dot && (
              <span className="w-2 h-2 rounded-full bg-current animate-pulse shrink-0" />
            )}
            <span>
              {mode === "ingest" ? "← 回到浏览" : ingestButton.label}
            </span>
            {mode === "browse" && ingestButton.suffix && (
              <span className="text-xs font-normal opacity-90 px-1.5 py-0.5 rounded-full bg-[rgba(0,0,0,0.15)]">
                {ingestButton.suffix}
              </span>
            )}
          </button>
        </div>
        <div className="flex items-center gap-3">
          {statusInfo && (
            <div className="text-xs text-[var(--meta)]" style={{ fontFamily: "var(--font-mono)" }}>
              {`${statusInfo.total} 条 · 上次入库 ${formatBeijingShort(statusInfo.last_ingest_at)}`}
            </div>
          )}
          <ModelSelector onChange={setModel} />
        </div>
      </header>

      {mode === "browse" ? (
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 p-1 h-9 rounded border border-[var(--hair)]">
              {kinds.map((k) => (
                <button
                  key={k}
                  onClick={() => { setKindFilter(k); setSelected(null); }}
                  className={`px-3 py-1 text-xs rounded ${kindFilter === k ? "bg-[var(--accent-fill)] text-[var(--accent)]" : "text-[var(--meta)] hover:text-[var(--heading)]"}`}
                >
                  {KIND_LABEL[k] ?? k}
                </button>
              ))}
            </div>
            <div className="flex-1">
              <Input
                value={q}
                onChange={(e) => runSearch(e.target.value)}
                placeholder="搜索标题 / 内容…"
                leftSlot="⌕"
                className="h-9"
              />
            </div>
          </div>

          {selected ? (
            <div className="rounded bg-[var(--bg-2)] p-4 relative">
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs text-[var(--meta)] font-semibold">{selected}</div>
                <button
                  onClick={() => setSelected(null)}
                  className="w-7 h-7 flex items-center justify-center rounded text-[var(--meta)] hover:text-[var(--heading)] hover:bg-[var(--bg-1)]"
                  aria-label="关闭"
                  title="关闭"
                >
                  ✕
                </button>
              </div>
              <WikiPagePreview
                path={selected}
                onNavigate={(p) => { setHits(null); setQ(""); setSelected(p); }}
                onOpenSource={(account, articleId) => setDrawerSource({ account, articleId })}
              />
            </div>
          ) : hits ? (
            <div className="grid grid-cols-2 gap-4">
              {hits.map((h) => (
                <article
                  key={h.path}
                  onClick={() => setSelected(h.path)}
                  className="rounded bg-[var(--bg-2)] p-4 cursor-pointer hover:ring-1 hover:ring-[var(--accent-soft)]"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h3 className="text-sm font-semibold text-[var(--heading)]">{h.title}</h3>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-[var(--bg-1)] text-[var(--meta)]">{KIND_LABEL[h.kind] ?? h.kind}</span>
                  </div>
                  <p className="text-xs text-[var(--body)] leading-relaxed mb-2 line-clamp-3">{h.excerpt}</p>
                  <div className="text-[10px] text-[var(--faint)]">匹配度 {h.score.toFixed(2)}</div>
                </article>
              ))}
              {hits.length === 0 && <div className="col-span-2 py-12 text-center text-[var(--meta)]">无匹配条目</div>}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {visible.map((p) => (
                <article
                  key={p.path}
                  onClick={() => setSelected(p.path)}
                  className="rounded bg-[var(--bg-2)] p-4 cursor-pointer hover:ring-1 hover:ring-[var(--accent-soft)]"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h3 className="text-sm font-semibold text-[var(--heading)]">{p.title}</h3>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-[var(--bg-1)] text-[var(--meta)]">{KIND_LABEL[p.kind] ?? p.kind}</span>
                  </div>
                  {p.aliases?.length > 0 && (
                    <div className="text-xs text-[var(--meta)] mb-2">别名：{p.aliases.join(" · ")}</div>
                  )}
                  <div className="flex items-center justify-between text-[10px] text-[var(--faint)]">
                    <span>{p.sources_count} 来源 · {p.backlinks_count} 反链</span>
                    <span>{formatBeijingShort(p.last_ingest)}</span>
                  </div>
                </article>
              ))}
              {visible.length === 0 && <div className="col-span-2 py-12 text-center text-[var(--meta)]">无匹配条目</div>}
            </div>
          )}
        </div>
      ) : (
        <div className="p-6">
          <IngestTab model={model} cart={cart} />
        </div>
      )}

      {(ingest.status !== "idle" || ingest.events.length > 0) && (
        <IngestConsoleFab
          events={ingest.events}
          status={ingest.status}
          error={ingest.error}
          onDismiss={ingest.dismiss}
        />
      )}
      <RawArticleDrawer
        open={drawerSource !== null}
        account={drawerSource?.account ?? null}
        articleId={drawerSource?.articleId ?? null}
        onClose={() => setDrawerSource(null)}
      />
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { WikiPagePreview } from "../components/wiki/WikiPagePreview.js";
import { RawArticleDrawer } from "../components/wiki/RawArticleDrawer.js";
import { IngestTab } from "../components/wiki/IngestTab.js";
import { ModelSelector } from "../components/wiki/ModelSelector.js";
import { IngestConsoleFab } from "../components/wiki/IngestConsoleFab.js";
import { Input, Button, Chip, PixelLoader } from "../components/ui";
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
  const [loading, setLoading] = useState(true);

  const ingest = useIngestState();
  const cart = useIngestCart({ maxArticles: MAX_ARTICLES });

  useEffect(() => {
    Promise.all([
      getPages().then(setPages).catch(() => setPages([])),
      wikiStatus().then(setStatusInfo).catch(() => setStatusInfo(null)),
    ]).finally(() => setLoading(false));
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
  type IngestBtnState = {
    variant: "primary" | "secondary" | "danger";
    label: string;
    dotColor?: string;
    chipVariant?: "amber" | "red" | "accent" | "neutral";
    chipLabel?: string;
    showPlus?: boolean;
  };

  const ingestButton: IngestBtnState = (() => {
    if (mode === "ingest") {
      return { variant: "secondary", label: "← 回到浏览" };
    }
    if (ingest.status === "running") {
      return { variant: "secondary", label: "入库中", dotColor: "var(--amber)" };
    }
    if (ingest.status === "error") {
      return { variant: "secondary", label: "入库失败", dotColor: "var(--red)" };
    }
    if (cart.totalCount > 0) {
      return { variant: "primary", label: "入库", showPlus: true, chipVariant: "accent", chipLabel: `${cart.totalCount}` };
    }
    return { variant: "primary", label: "入库", showPlus: true };
  })();

  return (
    <div data-testid="page-knowledge" className="rounded border border-[var(--hair)] bg-[var(--bg-1)] overflow-hidden">
      <header className="flex items-center justify-between px-6 h-14 border-b border-[var(--hair)]">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-semibold text-[var(--heading)]">知识库</h1>
          <Button
            data-testid="ingest-mode-toggle"
            variant={ingestButton.variant}
            size="sm"
            onClick={() => setMode(mode === "browse" ? "ingest" : "browse")}
            leftSlot={
              ingestButton.dotColor
                ? <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: ingestButton.dotColor }} />
                : ingestButton.showPlus
                ? "＋"
                : undefined
            }
            rightSlot={ingestButton.chipLabel ? (
              <Chip variant={ingestButton.chipVariant ?? "neutral"} size="sm" tone="solid">{ingestButton.chipLabel}</Chip>
            ) : undefined}
          >
            {ingestButton.label}
          </Button>
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

      {loading ? (
        <PixelLoader label="知识库载入中" />
      ) : mode === "browse" ? (
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="inline-flex items-center gap-0.5 p-1 h-10 rounded border border-[var(--hair)]">
              {kinds.map((k) => (
                <button
                  key={k}
                  onClick={() => { setKindFilter(k); setSelected(null); }}
                  className={`px-3 py-1 text-sm rounded whitespace-nowrap transition-colors ${kindFilter === k ? "bg-[var(--accent-fill)] text-[var(--accent)] font-semibold" : "text-[var(--meta)] hover:text-[var(--heading)] hover:bg-[var(--bg-2)]"}`}
                >
                  {KIND_LABEL[k] ?? k}
                </button>
              ))}
            </div>
            <div className="flex-1" aria-hidden="true" />
            <div className="flex-[3]">
              <Input
                value={q}
                onChange={(e) => runSearch(e.target.value)}
                placeholder="搜索标题 / 内容…"
                leftSlot="⌕"
                className="h-10"
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
        <div className="p-6 h-[calc(100vh-56px)] overflow-hidden">
          <IngestTab model={model} cart={cart} />
        </div>
      )}

      <IngestConsoleFab
        events={ingest.events}
        status={ingest.status}
        error={ingest.error}
        onDismiss={ingest.dismiss}
        onOpenPage={(p) => {
          setMode("browse");
          setHits(null);
          setQ("");
          setSelected(p);
        }}
      />
      <RawArticleDrawer
        open={drawerSource !== null}
        account={drawerSource?.account ?? null}
        articleId={drawerSource?.articleId ?? null}
        onClose={() => setDrawerSource(null)}
      />
    </div>
  );
}

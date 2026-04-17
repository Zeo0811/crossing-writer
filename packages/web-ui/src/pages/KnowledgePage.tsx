import { useEffect, useMemo, useState } from "react";
import { WikiPagePreview } from "../components/wiki/WikiPagePreview.js";
import { RawArticleDrawer } from "../components/wiki/RawArticleDrawer.js";
import { IngestTab } from "../components/wiki/IngestTab.js";
import { ModelSelector } from "../components/wiki/ModelSelector.js";
import { IngestConsoleFab } from "../components/wiki/IngestConsoleFab.js";
import { Tabs, TabsList, TabsTrigger, TabsContent, Input } from "../components/ui";
import { formatBeijingShort } from "../utils/time";
import { useIngestState } from "../hooks/useIngestState";
import {
  getPages,
  search as searchWikiApi,
  status as wikiStatus,
  type WikiPageMeta,
  type WikiSearchResult,
  type WikiStatus,
} from "../api/wiki-client.js";

type Tab = "browse" | "ingest";

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

export function KnowledgePage() {
  const [tab, setTab] = useState<Tab>("browse");
  const [pages, setPages] = useState<WikiPageMeta[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [hits, setHits] = useState<WikiSearchResult[] | null>(null);
  const [q, setQ] = useState("");
  const [kindFilter, setKindFilter] = useState<string>("全部");
  const [statusInfo, setStatusInfo] = useState<WikiStatus | null>(null);
  const [drawerSource, setDrawerSource] = useState<{ account: string; articleId: string } | null>(null);
  const [model, setModel] = useState<{ cli: "claude" | "codex"; model: string }>({ cli: "claude", model: "sonnet" });

  const ingest = useIngestState();

  useEffect(() => {
    void getPages().then(setPages).catch(() => setPages([]));
    void wikiStatus().then(setStatusInfo).catch(() => setStatusInfo(null));
  }, []);

  // Refresh after ingest done
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

  return (
    <div data-testid="page-knowledge" className="rounded border border-[var(--hair)] bg-[var(--bg-1)] overflow-hidden">
      <header className="flex items-center justify-between px-6 h-12 border-b border-[var(--hair)]">
        <h1 className="text-lg font-semibold text-[var(--heading)]">知识库</h1>
        <div className="flex items-center gap-3">
          {statusInfo && <div className="text-xs text-[var(--meta)]" style={{ fontFamily: "var(--font-mono)" }}>{`${statusInfo.total} 条 · 上次入库 ${formatBeijingShort(statusInfo.last_ingest_at)}`}</div>}
          <ModelSelector onChange={setModel} />
        </div>
      </header>
      {ingest.status === "running" && (
        <div className="px-6 py-2 border-b border-[var(--hair)] flex items-center gap-3 bg-[var(--accent-fill)]">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
          <span className="text-xs text-[var(--accent)] font-semibold">正在入库…</span>
          <span className="text-xs text-[var(--meta)]">{ingest.events.length} 条事件</span>
        </div>
      )}
      {ingest.status === "done" && (
        <div className="px-6 py-2 border-b border-[var(--hair)] flex items-center gap-3 bg-[var(--accent-fill)]">
          <span className="text-xs text-[var(--accent)] font-semibold">入库完成</span>
          <button onClick={ingest.dismiss} className="text-xs text-[var(--meta)] hover:text-[var(--heading)] ml-auto">关闭</button>
        </div>
      )}
      {ingest.status === "error" && (
        <div className="px-6 py-2 border-b border-[var(--red)] flex items-center gap-3 bg-[rgba(255,107,107,0.05)]">
          <span className="text-xs text-[var(--red)] font-semibold">入库失败：{ingest.error}</span>
          <button onClick={ingest.dismiss} className="text-xs text-[var(--meta)] hover:text-[var(--heading)] ml-auto">关闭</button>
        </div>
      )}
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <div className="px-6 pt-3">
          <TabsList>
            <TabsTrigger value="browse">浏览</TabsTrigger>
            <TabsTrigger value="ingest">入库</TabsTrigger>
          </TabsList>
        </div>

      <TabsContent value="browse" className="p-6 space-y-4">
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
      </TabsContent>

      <TabsContent value="ingest" className="p-6">
          <IngestTab model={model} />
      </TabsContent>
      </Tabs>

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

import { useEffect, useMemo, useState } from "react";
import { WikiPagePreview } from "../components/wiki/WikiPagePreview.js";
import { IngestForm } from "../components/wiki/IngestForm.js";
import { IngestProgressView } from "../components/wiki/IngestProgressView.js";
import { Tabs, TabsList, TabsTrigger, TabsContent, Input, Button } from "../components/ui";
import { formatBeijingShort } from "../utils/time";
import {
  getPages,
  search as searchWikiApi,
  startIngestStream,
  status as wikiStatus,
  type WikiPageMeta,
  type IngestStreamEvent,
  type IngestStartArgs,
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
  const [status, setStatusInfo] = useState<WikiStatus | null>(null);
  const [accounts, setAccounts] = useState<string[]>([]);

  const [ingestEvents, setIngestEvents] = useState<IngestStreamEvent[]>([]);
  const [ingestStatus, setIngestStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [ingestError, setIngestError] = useState<string | null>(null);

  useEffect(() => {
    void getPages().then(setPages).catch(() => setPages([]));
    void wikiStatus().then(setStatusInfo).catch(() => setStatusInfo(null));
    void fetch("/api/kb/accounts").then(async (r) => {
      if (r.ok) {
        const j = (await r.json()) as Array<{ account: string }>;
        setAccounts(j.map((a) => a.account));
      }
    }).catch(() => setAccounts([]));
  }, []);

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
    if (!query.trim()) { setHits(null); return; }
    void searchWikiApi({ query, limit: 40 }).then(setHits).catch(() => setHits([]));
  }

  const handleIngestStart = (args: IngestStartArgs) => {
    setIngestEvents([]);
    setIngestStatus("running");
    setIngestError(null);
    startIngestStream(
      args,
      (e) => setIngestEvents((prev) => [...prev, e]),
      () => {
        setIngestStatus("done");
        void getPages().then(setPages);
        void wikiStatus().then(setStatusInfo);
      },
      (err) => { setIngestStatus("error"); setIngestError(err); },
    );
  };

  return (
    <div data-testid="page-knowledge" className="rounded border border-[var(--hair)] bg-[var(--bg-1)] overflow-hidden">
      <header className="flex items-center justify-between px-6 h-12 border-b border-[var(--hair)]">
        <h1 className="text-lg font-semibold text-[var(--heading)]">知识库</h1>
        <div className="text-xs text-[var(--meta)]" style={{ fontFamily: "var(--font-mono)" }}>
          {status && `${status.total} 条 · 上次入库 ${formatBeijingShort(status.last_ingest_at)}`}
        </div>
      </header>
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <div className="px-6 pt-3">
          <TabsList>
            <TabsTrigger value="browse">浏览</TabsTrigger>
            <TabsTrigger value="ingest">入库</TabsTrigger>
          </TabsList>
        </div>

      <TabsContent value="browse" className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 p-1 rounded border border-[var(--hair)]">
              {kinds.map((k) => (
                <button
                  key={k}
                  onClick={() => setKindFilter(k)}
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
              />
            </div>
          </div>

          {selected ? (
            <div className="rounded bg-[var(--bg-2)] p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs text-[var(--meta)] font-semibold">{selected}</div>
                <Button variant="link" size="sm" onClick={() => setSelected(null)}>← 返回列表</Button>
              </div>
              <WikiPagePreview path={selected} />
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
        <div className="max-w-[880px] space-y-5">
          <IngestForm
            accounts={accounts}
            onSubmit={handleIngestStart}
            disabled={ingestStatus === "running"}
          />
          {(ingestStatus !== "idle" || ingestEvents.length > 0 || ingestError) && (
            <IngestProgressView events={ingestEvents} status={ingestStatus} error={ingestError} />
          )}
        </div>
      </TabsContent>
      </Tabs>
    </div>
  );
}

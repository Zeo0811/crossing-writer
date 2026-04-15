import { useEffect, useMemo, useState } from "react";
import { WikiPagePreview } from "../components/wiki/WikiPagePreview.js";
import { IngestForm } from "../components/wiki/IngestForm.js";
import { IngestProgressView } from "../components/wiki/IngestProgressView.js";
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
  entity: "实体",
  event: "事件",
  author: "作者",
  source: "来源",
  note: "笔记",
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
        <h1 className="text-base font-semibold text-[var(--heading)]">知识库</h1>
        <div className="text-xs text-[var(--meta)]" style={{ fontFamily: "var(--font-mono)" }}>
          {status && `${status.total} 条 · 上次入库 ${status.last_ingest_at ?? "—"}`}
        </div>
      </header>
      <div className="flex items-center gap-1 px-6 pt-3 border-b border-[var(--hair)]">
        <button
          type="button" role="tab" aria-selected={tab === "browse"}
          onClick={() => setTab("browse")}
          className={`px-4 py-2.5 text-sm border-b-2 -mb-px ${tab === "browse" ? "border-[var(--accent)] text-[var(--heading)]" : "border-transparent text-[var(--meta)] hover:text-[var(--heading)]"}`}
        >
          浏览
        </button>
        <button
          type="button" role="tab" aria-selected={tab === "ingest"}
          onClick={() => setTab("ingest")}
          className={`px-4 py-2.5 text-sm border-b-2 -mb-px ${tab === "ingest" ? "border-[var(--accent)] text-[var(--heading)]" : "border-transparent text-[var(--meta)] hover:text-[var(--heading)]"}`}
        >
          入库
        </button>
      </div>

      {tab === "browse" && (
        <div className="p-6 space-y-4">
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
            <div className="flex-1 relative">
              <input
                value={q}
                onChange={(e) => runSearch(e.target.value)}
                placeholder="搜索标题 / 内容…"
                className="w-full bg-[var(--bg-2)] border border-[var(--hair)] rounded px-3 py-2 pl-9 text-sm outline-none focus:border-[var(--accent-soft)]"
              />
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)]">⌕</span>
            </div>
          </div>

          {selected ? (
            <div className="rounded bg-[var(--bg-2)] p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs text-[var(--meta)] font-semibold">{selected}</div>
                <button onClick={() => setSelected(null)} className="text-xs text-[var(--accent)] hover:underline">← 返回列表</button>
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
                    <span>{p.last_ingest?.slice(0, 10)}</span>
                  </div>
                </article>
              ))}
              {visible.length === 0 && <div className="col-span-2 py-12 text-center text-[var(--meta)]">无匹配条目</div>}
            </div>
          )}
        </div>
      )}

      {tab === "ingest" && (
        <div className="grid grid-cols-2 gap-0 min-h-[560px]">
          <div className="p-6 border-r border-[var(--hair)]">
            <IngestForm accounts={accounts} onSubmit={handleIngestStart} />
          </div>
          <div className="p-6">
            <IngestProgressView events={ingestEvents} status={ingestStatus} error={ingestError} />
          </div>
        </div>
      )}
    </div>
  );
}

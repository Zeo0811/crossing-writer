import { useEffect, useState } from "react";
import { WikiTree } from "../components/wiki/WikiTree.js";
import { WikiPagePreview } from "../components/wiki/WikiPagePreview.js";
import { WikiSearchBox } from "../components/wiki/WikiSearchBox.js";
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

export function KnowledgePage() {
  const [tab, setTab] = useState<Tab>("browse");
  const [pages, setPages] = useState<WikiPageMeta[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [hits, setHits] = useState<WikiSearchResult[] | null>(null);
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

  const handleSearch = (q: string) => {
    void searchWikiApi({ query: q, limit: 20 }).then(setHits).catch(() => setHits([]));
  };

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
    <div data-testid="page-knowledge" className="rounded border border-[var(--hair)] bg-[var(--bg-1)] overflow-hidden flex flex-col">
      <header className="flex items-center justify-between px-6 h-12 border-b border-[var(--hair)]">
        <h1 className="text-base font-semibold text-[var(--heading)]">知识库</h1>
        <div className="text-xs text-[var(--meta)]" style={{ fontFamily: "var(--font-mono)" }}>
          {status && `${status.total} 条 · 上次入库 ${status.last_ingest_at ?? "—"}`}
        </div>
      </header>
      <div className="flex items-center gap-1 px-6 pt-3 border-b border-[var(--hair)]">
        <button type="button" role="tab" aria-selected={tab === "browse"} onClick={() => setTab("browse")} className={`px-4 py-2.5 text-sm border-b-2 -mb-px ${tab === "browse" ? "border-[var(--accent)] text-[var(--heading)]" : "border-transparent text-[var(--meta)] hover:text-[var(--heading)]"}`}>浏览</button>
        <button type="button" role="tab" aria-selected={tab === "ingest"} onClick={() => setTab("ingest")} className={`px-4 py-2.5 text-sm border-b-2 -mb-px ${tab === "ingest" ? "border-[var(--accent)] text-[var(--heading)]" : "border-transparent text-[var(--meta)] hover:text-[var(--heading)]"}`}>入库</button>
      </div>

      {tab === "browse" && (
        <div className="grid grid-cols-[320px_1fr] flex-1 overflow-hidden">
          <div className="border-r border-hair flex flex-col">
            <div className="p-2 border-b border-hair">
              <WikiSearchBox onSearch={handleSearch} />
            </div>
            {hits ? (
              <ul className="list-none m-0 p-2 overflow-auto">
                {hits.map((h) => (
                  <li key={h.path} onClick={() => setSelected(h.path)} className={`cursor-pointer p-1 ${selected === h.path ? "bg-accent-fill text-accent" : "text-body"}`}>
                    <div className="font-semibold text-sm">{h.title} <span className="text-xs text-meta">({h.kind} · {h.score.toFixed(2)})</span></div>
                    <div className="text-xs text-meta">{h.excerpt}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <WikiTree pages={pages} selected={selected} onSelect={setSelected} />
            )}
          </div>
          <WikiPagePreview path={selected} />
        </div>
      )}

      {tab === "ingest" && (
        <div className="grid grid-cols-2 flex-1 overflow-auto">
          <IngestForm accounts={accounts} onSubmit={handleIngestStart} />
          <div className="p-4">
            <IngestProgressView events={ingestEvents} status={ingestStatus} error={ingestError} />
          </div>
        </div>
      )}
    </div>
  );
}

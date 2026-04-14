import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
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
    <div className="flex flex-col h-screen">
      <div className="flex gap-4 border-b px-4 py-2 items-center">
        <Link to="/" className="text-sm text-gray-500 hover:text-black">← 返回项目</Link>
        <h1 className="text-lg font-semibold">知识库</h1>
        <button role="tab" aria-selected={tab === "browse"} onClick={() => setTab("browse")} className={`px-3 py-1 rounded ${tab === "browse" ? "bg-gray-200 font-semibold" : ""}`}>Browse</button>
        <button role="tab" aria-selected={tab === "ingest"} onClick={() => setTab("ingest")} className={`px-3 py-1 rounded ${tab === "ingest" ? "bg-gray-200 font-semibold" : ""}`}>Ingest</button>
        <div className="ml-auto text-xs text-gray-500">
          {status && `${status.total} pages · last_ingest=${status.last_ingest_at ?? "never"}`}
        </div>
      </div>

      {tab === "browse" && (
        <div className="grid grid-cols-[320px_1fr] flex-1 overflow-hidden">
          <div className="border-r flex flex-col">
            <div className="p-2 border-b">
              <WikiSearchBox onSearch={handleSearch} />
            </div>
            {hits ? (
              <ul className="list-none m-0 p-2 overflow-auto">
                {hits.map((h) => (
                  <li key={h.path} onClick={() => setSelected(h.path)} className={`cursor-pointer p-1 ${selected === h.path ? "bg-blue-100" : ""}`}>
                    <div className="font-semibold text-sm">{h.title} <span className="text-xs text-gray-500">({h.kind} · {h.score.toFixed(2)})</span></div>
                    <div className="text-xs text-gray-700">{h.excerpt}</div>
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

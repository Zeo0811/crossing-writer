import { useEffect, useMemo, useState } from "react";
import {
  listIngestRuns,
  getIngestRun,
  type IngestRunSummary,
  type IngestRunDetail,
} from "../../api/wiki-client";
import { formatBeijingShort } from "../../utils/time";

interface Props {
  onOpenPage?: (path: string) => void;
}

function statusColor(status: string): string {
  if (status === "done") return "var(--accent)";
  if (status === "running") return "var(--amber)";
  if (status === "error") return "var(--red)";
  return "var(--faint)";
}

function statusLabel(status: string): string {
  if (status === "done") return "已完成";
  if (status === "running") return "运行中";
  if (status === "error") return "失败";
  if (status === "cancelled") return "已取消";
  return status;
}

function duration(started: string, finished: string | null): string {
  if (!finished) return "—";
  const ms = new Date(finished).getTime() - new Date(started).getTime();
  if (ms < 0 || !isFinite(ms)) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m${s}s`;
}

export function IngestRunsHistory({ onOpenPage }: Props) {
  const [runs, setRuns] = useState<IngestRunSummary[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<IngestRunDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    void listIngestRuns({ limit: 50 }).then(setRuns).catch(() => setRuns([]));
  }, []);

  useEffect(() => {
    if (!activeId) { setDetail(null); return; }
    setDetailLoading(true);
    void getIngestRun(activeId)
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setDetailLoading(false));
  }, [activeId]);

  const grouped = useMemo(() => {
    if (!detail) return { created: [], updated: [], appended: [], errors: [] };
    const created: string[] = [];
    const updated: string[] = [];
    const appended: string[] = [];
    const errors: { op: string; path: string | null; error: string }[] = [];
    for (const o of detail.ops) {
      if (o.error) {
        errors.push({ op: o.op, path: o.path, error: o.error });
        continue;
      }
      if (!o.path) continue;
      if (o.op === "upsert" && o.created_page) created.push(o.path);
      else if (o.op === "upsert") updated.push(o.path);
      else if (o.op === "append_source" || o.op === "append_image") appended.push(o.path);
    }
    return { created, updated, appended, errors };
  }, [detail]);

  if (runs === null) {
    return <div className="py-12 text-center text-sm text-[var(--meta)]">加载中…</div>;
  }
  if (runs.length === 0) {
    return <div className="py-12 text-center text-sm text-[var(--faint)]">暂无入库记录</div>;
  }

  return (
    <div className="flex gap-4 h-full min-h-0">
      <aside className="w-[320px] shrink-0 overflow-y-auto rounded bg-[var(--bg-2)]">
        <div className="sticky top-0 z-10 px-3 py-2 border-b border-[var(--hair)] bg-[var(--bg-2)] text-xs text-[var(--meta)] font-semibold">
          最近 {runs.length} 次入库
        </div>
        <ul>
          {runs.map((r) => {
            const isActive = activeId === r.id;
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setActiveId(r.id)}
                  className={`w-full text-left px-3 py-2.5 border-b border-[var(--hair)] last:border-b-0 ${
                    isActive ? "bg-[var(--accent-fill)]" : "hover:bg-[var(--bg-1)]"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: statusColor(r.status) }}
                    />
                    <span className="text-xs text-[var(--heading)] font-medium">
                      {formatBeijingShort(r.started_at)}
                    </span>
                    <span className="text-[10px] text-[var(--faint)] ml-auto">
                      {duration(r.started_at, r.finished_at)}
                    </span>
                  </div>
                  <div className="text-[11px] text-[var(--meta)] truncate mb-1">
                    {r.accounts.length > 0 ? r.accounts.join(" · ") : "—"}
                  </div>
                  <div className="flex items-center gap-2 text-[10px]">
                    <span style={{ color: statusColor(r.status) }}>{statusLabel(r.status)}</span>
                    <span className="text-[var(--faint)]">·</span>
                    <span className="text-[var(--faint)]">
                      +{r.pages_created} 新建 · {r.pages_updated} 更新 · {r.sources_appended} 追加
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      <section className="flex-1 min-w-0 overflow-y-auto rounded bg-[var(--bg-2)] p-5">
        {!activeId && (
          <div className="py-24 text-center text-sm text-[var(--faint)]">
            左侧选一次入库查看详情
          </div>
        )}
        {activeId && detailLoading && (
          <div className="py-24 text-center text-sm text-[var(--meta)]">加载详情…</div>
        )}
        {detail && !detailLoading && (
          <div className="space-y-5">
            <div className="flex items-center gap-3 flex-wrap">
              <span
                className="inline-flex items-center gap-1.5 text-xs font-semibold"
                style={{ color: statusColor(detail.status) }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: statusColor(detail.status) }}
                />
                {statusLabel(detail.status)}
              </span>
              <span className="text-xs text-[var(--meta)]">
                {formatBeijingShort(detail.started_at)}
              </span>
              <span className="text-xs text-[var(--faint)]">
                · {duration(detail.started_at, detail.finished_at)}
              </span>
              <span className="text-xs text-[var(--faint)]">· {detail.model}</span>
              <span className="text-xs text-[var(--faint)]">· {detail.mode}</span>
            </div>

            {detail.error && (
              <div className="rounded border border-[var(--red)] bg-[rgba(255,107,107,0.05)] px-3 py-2 text-sm text-[var(--red)]">
                {detail.error}
              </div>
            )}

            <div className="grid grid-cols-4 gap-2 text-center">
              <Stat value={detail.pages_created} label="新建页" />
              <Stat value={detail.pages_updated} label="更新页" />
              <Stat value={detail.sources_appended} label="追加来源" />
              <Stat value={detail.skipped_count} label="已跳过" />
            </div>

            {detail.accounts.length > 0 && (
              <div>
                <div className="text-xs text-[var(--meta)] font-semibold mb-1.5">涉及账号</div>
                <div className="flex flex-wrap gap-1.5">
                  {detail.accounts.map((a) => (
                    <span
                      key={a}
                      className="text-xs px-2 py-0.5 rounded bg-[var(--bg-1)] text-[var(--body)]"
                    >
                      {a}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <OpGroup title="新建页面" paths={grouped.created} onOpen={onOpenPage} />
            <OpGroup title="更新页面" paths={grouped.updated} onOpen={onOpenPage} />
            <OpGroup title="追加来源 / 图片" paths={grouped.appended} onOpen={onOpenPage} />

            {grouped.errors.length > 0 && (
              <div>
                <div className="text-xs text-[var(--red)] font-semibold mb-1.5">
                  错误（{grouped.errors.length}）
                </div>
                <ul className="space-y-1 text-xs">
                  {grouped.errors.map((e, i) => (
                    <li key={i} className="text-[var(--red)]">
                      [{e.op}] {e.path ?? ""} — {e.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded bg-[var(--bg-1)] py-3">
      <div className="text-lg font-semibold text-[var(--heading)]" style={{ fontFamily: "var(--font-mono)" }}>
        {value}
      </div>
      <div className="text-[10px] text-[var(--meta)] mt-0.5">{label}</div>
    </div>
  );
}

function OpGroup({
  title,
  paths,
  onOpen,
}: {
  title: string;
  paths: string[];
  onOpen?: (path: string) => void;
}) {
  if (paths.length === 0) return null;
  const unique = Array.from(new Set(paths));
  return (
    <div>
      <div className="text-xs text-[var(--meta)] font-semibold mb-1.5">
        {title}（{unique.length}）
      </div>
      <ul className="space-y-0.5 text-xs" style={{ fontFamily: "var(--font-mono)" }}>
        {unique.map((p) => (
          <li key={p}>
            {onOpen ? (
              <button
                type="button"
                onClick={() => onOpen(p)}
                className="text-[var(--accent)] hover:underline text-left"
              >
                {p}
              </button>
            ) : (
              <span className="text-[var(--body)]">{p}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

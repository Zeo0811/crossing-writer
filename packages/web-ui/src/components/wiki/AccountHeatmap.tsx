import { useEffect, useMemo, useState } from "react";
import { formatBeijingDate } from "../../utils/time";

interface Article {
  id: string;
  title: string;
  published_at: string;
  ingest_status: string;
  word_count: number | null;
}

interface Props {
  account: string;
  onIngestSelected?: (ids: string[]) => void;
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 86400000);
}

function weekStart(d: Date): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() - copy.getDay());
  return copy;
}

export function AccountHeatmap({ account, onIngestSelected }: Props) {
  const [articles, setArticles] = useState<Article[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    setArticles(null);
    setSelected(new Set());
    fetch(`/api/kb/accounts/${encodeURIComponent(account)}/articles?limit=3000`)
      .then((r) => r.json())
      .then(setArticles)
      .catch(() => setArticles([]));
  }, [account]);

  const { cells, weeks, months } = useMemo(() => {
    if (!articles || articles.length === 0) return { cells: [], weeks: 0, months: [] as string[] };

    const byDate = new Map<string, Article[]>();
    for (const a of articles) {
      const d = a.published_at.slice(0, 10);
      const arr = byDate.get(d) ?? [];
      arr.push(a);
      byDate.set(d, arr);
    }

    const dates = [...byDate.keys()].sort();
    const earliest = new Date(dates[0]!);
    const latest = new Date(dates[dates.length - 1]!);
    const start = weekStart(earliest);
    const totalDays = daysBetween(start, latest) + 1;
    const totalWeeks = Math.ceil(totalDays / 7);

    const cells: Array<{
      date: string;
      day: number; // 0-6 (Sun-Sat)
      week: number;
      articles: Article[];
      ingested: number;
      total: number;
    }> = [];

    for (let w = 0; w < totalWeeks; w++) {
      for (let d = 0; d < 7; d++) {
        const offset = w * 7 + d;
        const cellDate = new Date(start);
        cellDate.setDate(cellDate.getDate() + offset);
        const key = cellDate.toISOString().slice(0, 10);
        const arts = byDate.get(key) ?? [];
        const ingested = arts.filter((a) => a.ingest_status !== "raw" && a.ingest_status !== "tag_failed").length;
        cells.push({ date: key, day: d, week: w, articles: arts, ingested, total: arts.length });
      }
    }

    const months: string[] = [];
    let lastMonth = "";
    for (let w = 0; w < totalWeeks; w++) {
      const cell = cells[w * 7];
      if (cell) {
        const m = cell.date.slice(0, 7);
        months.push(m !== lastMonth ? m.slice(5) + "月" : "");
        lastMonth = m;
      }
    }

    return { cells, weeks: totalWeeks, months };
  }, [articles]);

  function toggleArticle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  function toggleDate(date: string, rawIds: string[]) {
    if (rawIds.length === 0) return;
    setSelected((s) => {
      const n = new Set(s);
      const allIn = rawIds.every((id) => n.has(id));
      if (allIn) {
        for (const id of rawIds) n.delete(id);
      } else {
        for (const id of rawIds) n.add(id);
      }
      return n;
    });
  }

  function selectAllRaw() {
    if (!articles) return;
    setSelected(new Set(articles.filter((a) => a.ingest_status === "raw" || a.ingest_status === "tag_failed").map((a) => a.id)));
  }

  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const hoveredArticles = useMemo(() => {
    if (!hoveredDate || !articles) return [];
    return articles.filter((a) => a.published_at.startsWith(hoveredDate));
  }, [hoveredDate, articles]);

  if (articles === null) return <div className="py-4 text-xs text-[var(--meta)]">加载 {account} 的文章…</div>;
  if (articles.length === 0) return <div className="py-4 text-xs text-[var(--faint)]">该账号无文章</div>;

  const rawCount = articles.filter((a) => a.ingest_status === "raw" || a.ingest_status === "tag_failed").length;
  const cellSize = 12;
  const gap = 2;
  const svgW = weeks * (cellSize + gap);
  const svgH = 7 * (cellSize + gap) + 20;

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto pb-2">
        <svg width={svgW} height={svgH} className="block">
          {/* month labels */}
          {months.map((m, i) => m ? (
            <text key={i} x={i * (cellSize + gap)} y={10} fontSize={9} fill="var(--meta)">{m}</text>
          ) : null)}
          {cells.map((c, i) => {
            if (c.total === 0) {
              return (
                <rect
                  key={i}
                  x={c.week * (cellSize + gap)}
                  y={c.day * (cellSize + gap) + 16}
                  width={cellSize}
                  height={cellSize}
                  rx={2}
                  fill="var(--bg-2)"
                />
              );
            }
            const allIngested = c.ingested === c.total;
            const partial = c.ingested > 0 && c.ingested < c.total;
            const rawIds = c.articles.filter((a) => a.ingest_status === "raw" || a.ingest_status === "tag_failed").map((a) => a.id);
            const someSelected = rawIds.some((id) => selected.has(id));
            const allSelected = rawIds.length > 0 && rawIds.every((id) => selected.has(id));
            const fill = allIngested
              ? "var(--accent)"
              : allSelected
              ? "var(--amber)"
              : someSelected
              ? "var(--amber-hair)"
              : partial
              ? "var(--accent-soft)"
              : "var(--hair-strong)";
            const opacity = Math.min(0.3 + (c.total / 10) * 0.7, 1);
            return (
              <rect
                key={i}
                x={c.week * (cellSize + gap)}
                y={c.day * (cellSize + gap) + 16}
                width={cellSize}
                height={cellSize}
                rx={2}
                fill={fill}
                opacity={opacity}
                className="cursor-pointer"
                onClick={() => toggleDate(c.date, rawIds)}
                onMouseEnter={() => setHoveredDate(c.date)}
                onMouseLeave={() => setHoveredDate(null)}
              />
            );
          })}
        </svg>
      </div>

      <div className="flex items-center gap-3 text-xs text-[var(--meta)]">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm" style={{ background: "var(--hair-strong)" }} /> 未入库
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm" style={{ background: "var(--amber)" }} /> 已选中
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm" style={{ background: "var(--accent-soft)" }} /> 部分入库
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm" style={{ background: "var(--accent)" }} /> 全部入库
        </span>
        <span className="ml-auto">{selected.size > 0 ? `已选 ${selected.size} / ` : ""}{rawCount} 篇未入库</span>
      </div>

      {hoveredDate && hoveredArticles.length > 0 && (
        <div className="rounded bg-[var(--bg-2)] p-3">
          <div className="text-xs text-[var(--meta)] font-semibold mb-2">
            {formatBeijingDate(hoveredDate)} · {hoveredArticles.length} 篇
          </div>
          <div className="space-y-1 max-h-[200px] overflow-auto">
            {hoveredArticles.map((a) => {
              const isRaw = a.ingest_status === "raw" || a.ingest_status === "tag_failed";
              const checked = selected.has(a.id);
              return (
                <div
                  key={a.id}
                  className={`flex items-center gap-2 px-2 py-1 rounded text-xs ${
                    isRaw ? "cursor-pointer hover:bg-[var(--bg-1)]" : ""
                  }`}
                  onClick={() => isRaw && toggleArticle(a.id)}
                >
                  {isRaw && (
                    <span className={`w-3 h-3 rounded-sm border flex items-center justify-center text-[8px] shrink-0 ${
                      checked ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-on)]" : "border-[var(--hair-strong)]"
                    }`}>
                      {checked && "✓"}
                    </span>
                  )}
                  {!isRaw && <span className="w-3 h-3 rounded-sm bg-[var(--accent)] shrink-0" />}
                  <span className={`truncate flex-1 ${isRaw ? "text-[var(--body)]" : "text-[var(--meta)]"}`}>{a.title}</span>
                  <span className="text-[var(--faint)] shrink-0">{a.word_count ?? "—"} 字</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {rawCount > 0 && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={selectAllRaw}
              className="text-xs text-[var(--accent)] hover:underline"
            >
              全选未入库（{rawCount}）
            </button>
            {selected.size > 0 && (
              <button onClick={() => setSelected(new Set())} className="text-xs text-[var(--meta)] hover:text-[var(--heading)]">
                清空选择
              </button>
            )}
          </div>
          {selected.size > 0 && onIngestSelected && (
            <button
              onClick={() => onIngestSelected([...selected])}
              className="px-4 py-1.5 rounded border border-[var(--accent-soft)] bg-[var(--accent)] text-[var(--accent-on)] text-xs font-semibold"
            >
              入库选中 {selected.size} 篇 →
            </button>
          )}
        </div>
      )}
    </div>
  );
}

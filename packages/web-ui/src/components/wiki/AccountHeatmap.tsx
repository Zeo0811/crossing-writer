import { useEffect, useMemo, useState } from "react";

interface Article {
  id: string;
  title: string;
  published_at: string;
  ingest_status: string;
  word_count: number | null;
}

interface Props {
  account: string;
  selectedDate?: string | null;
  onDateSelect?: (date: string | null) => void;
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 86400000);
}

function weekStart(d: Date): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() - copy.getDay());
  return copy;
}

export function AccountHeatmap({ account, selectedDate, onDateSelect }: Props) {
  const [articles, setArticles] = useState<Article[] | null>(null);

  useEffect(() => {
    setArticles(null);
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
      day: number;
      week: number;
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
        cells.push({ date: key, day: d, week: w, ingested, total: arts.length });
      }
    }

    const months: string[] = [];
    let lastLabeledMonth = "";
    for (let w = 0; w < totalWeeks; w++) {
      const cell = cells[w * 7];
      if (cell) {
        const m = cell.date.slice(0, 7);
        const day = Number(cell.date.slice(8, 10));
        // Only label if this week contains the first 7 days of a new month
        if (m !== lastLabeledMonth && day <= 7) {
          months.push(m.slice(5) + "月");
          lastLabeledMonth = m;
        } else {
          months.push("");
        }
      }
    }

    return { cells, weeks: totalWeeks, months };
  }, [articles]);

  if (articles === null) return <div className="py-4 text-xs text-[var(--meta)]">加载 {account} 的文章…</div>;
  if (articles.length === 0) return <div className="py-4 text-xs text-[var(--faint)]">该账号无文章</div>;

  const cellSize = 12;
  const gap = 2;
  const svgW = weeks * (cellSize + gap);
  const svgH = 7 * (cellSize + gap) + 20;

  return (
    <div className="space-y-3">
      <div className="pb-2 select-none">
        <svg
          width="100%"
          viewBox={`0 0 ${svgW} ${svgH}`}
          preserveAspectRatio="xMinYMid meet"
          className="block"
        >
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
            const isSelected = selectedDate === c.date;
            const fill = allIngested
              ? "var(--accent)"
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
                stroke={isSelected ? "var(--accent)" : "none"}
                strokeWidth={isSelected ? 2 : 0}
                className="cursor-pointer"
                onClick={() => onDateSelect?.(selectedDate === c.date ? null : c.date)}
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
          <span className="w-3 h-3 rounded-sm" style={{ background: "var(--accent-soft)" }} /> 部分入库
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm" style={{ background: "var(--accent)" }} /> 全部入库
        </span>
        <span className="ml-auto text-[10px] text-[var(--faint)]">点击格子筛选当日文章</span>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { useIngestState } from "../../hooks/useIngestState";

interface Article {
  id: string;
  title: string;
  published_at: string;
  ingest_status: string;
  word_count: number | null;
}

interface Props {
  account: string;
  selectedDates?: Set<string>;
  onDateToggle?: (date: string) => void;
  onClearDates?: () => void;
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 86400000);
}

function weekStart(d: Date): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() - copy.getDay());
  return copy;
}

export function AccountHeatmap({ account, selectedDates, onDateToggle, onClearDates }: Props) {
  const [articles, setArticles] = useState<Article[] | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);
  const { completedSeq } = useIngestState();

  // Drag-to-select. Two modes:
  //   - paint (default): drag adds/removes each cell the pointer passes over,
  //     based on whether the starting cell was already selected.
  //   - box (Shift+drag): drag out a rubberband rectangle; on release every
  //     cell inside the rectangle is added to the selection.
  // While dragging we maintain a local draft so the preview tracks the pointer
  // without a React state round-trip to the parent. On pointerup we diff draft
  // against selectedDates and only surface the final delta.
  const [draft, setDraft] = useState<Set<string> | null>(null);
  const dragModeRef = useRef<null | "paint-add" | "paint-remove" | "box">(null);
  const [boxRect, setBoxRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const boxAnchorRef = useRef<{ x: number; y: number } | null>(null);

  const paintToggle = (date: string) => {
    if (dragModeRef.current !== "paint-add" && dragModeRef.current !== "paint-remove") return;
    setDraft((prev) => {
      const base = prev ?? new Set(selectedDates ?? []);
      const next = new Set(base);
      if (dragModeRef.current === "paint-add") next.add(date);
      else next.delete(date);
      return next;
    });
  };

  useEffect(() => {
    if (!dragModeRef.current) return;
    const up = () => {
      if (draft) {
        const before = new Set(selectedDates ?? []);
        for (const d of draft) if (!before.has(d)) onDateToggle?.(d);
        for (const d of before) if (!draft.has(d)) onDateToggle?.(d);
      }
      dragModeRef.current = null;
      boxAnchorRef.current = null;
      setDraft(null);
      setBoxRect(null);
    };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [draft, selectedDates, onDateToggle]);

  const effectiveSelected = draft ?? selectedDates;

  useEffect(() => {
    setArticles(null);
    fetch(`/api/kb/accounts/${encodeURIComponent(account)}/articles?limit=3000`)
      .then((r) => r.json())
      .then(setArticles)
      .catch(() => setArticles([]));
  }, [account]);

  // Refresh on ingest completion so the grid colors update in place
  useEffect(() => {
    if (completedSeq === 0) return;
    fetch(`/api/kb/accounts/${encodeURIComponent(account)}/articles?limit=3000`)
      .then((r) => r.json())
      .then(setArticles)
      .catch(() => {});
  }, [completedSeq, account]);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const obs = new ResizeObserver(() => setContainerWidth(el.clientWidth));
    obs.observe(el);
    setContainerWidth(el.clientWidth);
    return () => obs.disconnect();
  }, []);

  // Default-scroll to the newest week so the user sees this-month data
  // on open, instead of having to scroll from 10-月 on the far left.
  // Only fires when the natural grid is wider than the container (i.e.
  // the stretched branch in the layout math doesn't apply).
  useEffect(() => {
    if (!containerRef.current) return;
    if (!articles || articles.length === 0) return;
    const el = containerRef.current;
    requestAnimationFrame(() => {
      el.scrollLeft = el.scrollWidth;
    });
  }, [articles, containerWidth]);

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

  const MIN_CELL = 12;
  const MAX_CELL = 22;
  const gap = 2;
  const naturalCellBase = MIN_CELL + gap;
  const naturalW = weeks * naturalCellBase;
  // If natural width fits the container, stretch cells up to MAX_CELL.
  // Otherwise keep MIN_CELL and use horizontal scroll.
  const stretched = naturalW < containerWidth;
  const cellSize = stretched
    ? Math.min(MAX_CELL, Math.floor((containerWidth - 4) / weeks) - gap)
    : MIN_CELL;
  const svgW = weeks * (cellSize + gap);
  const svgH = 7 * (cellSize + gap) + 20;

  // Hit-test a pointer position against the grid to find the underlying
  // date. We take the SVG's bounding rect then reverse the layout.
  // Returns null if the pointer is on an empty cell (total=0), a gap, or
  // the header row — callers use that null to switch into box-selection.
  const cellAtPoint = (svg: SVGSVGElement, clientX: number, clientY: number): string | null => {
    const r = svg.getBoundingClientRect();
    const x = clientX - r.left;
    const y = clientY - r.top - 16;
    if (x < 0 || y < 0) return null;
    const cellStride = cellSize + gap;
    const w = Math.floor(x / cellStride);
    const d = Math.floor(y / cellStride);
    if (w < 0 || w >= weeks || d < 0 || d > 6) return null;
    // Guard against gap pixels between cells so a press in the 2px
    // seam lands on "blank" and starts the rubberband.
    const localX = x - w * cellStride;
    const localY = y - d * cellStride;
    if (localX >= cellSize || localY >= cellSize) return null;
    const idx = w * 7 + d;
    const c = cells[idx];
    return c && c.total > 0 ? c.date : null;
  };

  return (
    <div className="space-y-3">
      <div ref={containerRef} className="overflow-x-auto pb-2 select-none">
        <svg
          width={svgW}
          height={svgH}
          className="block touch-none"
          onPointerDown={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const localX = e.clientX - r.left;
            const localY = e.clientY - r.top;
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            const date = cellAtPoint(e.currentTarget, e.clientX, e.clientY);
            if (date) {
              // Press started on a real cell: paint mode.
              const alreadyIn = selectedDates?.has(date) ?? false;
              dragModeRef.current = alreadyIn ? "paint-remove" : "paint-add";
              const next = new Set(selectedDates ?? []);
              if (alreadyIn) next.delete(date); else next.add(date);
              setDraft(next);
            } else {
              // Press started on a blank spot (gap, empty cell, header):
              // rubberband mode.
              dragModeRef.current = "box";
              boxAnchorRef.current = { x: localX, y: localY };
              setBoxRect({ x: localX, y: localY, w: 0, h: 0 });
              setDraft(new Set(selectedDates ?? []));
            }
          }}
          onPointerMove={(e) => {
            if (!dragModeRef.current) return;
            const r = e.currentTarget.getBoundingClientRect();
            const localX = e.clientX - r.left;
            const localY = e.clientY - r.top;
            if (dragModeRef.current === "box") {
              const a = boxAnchorRef.current;
              if (!a) return;
              const x = Math.min(a.x, localX);
              const y = Math.min(a.y, localY);
              const w = Math.abs(localX - a.x);
              const h = Math.abs(localY - a.y);
              setBoxRect({ x, y, w, h });
              const base = new Set(selectedDates ?? []);
              // Which cells intersect the box?
              for (const c of cells) {
                if (c.total === 0) continue;
                const cx = c.week * (cellSize + gap);
                const cy = c.day * (cellSize + gap) + 16;
                const overlaps = cx + cellSize >= x && cx <= x + w && cy + cellSize >= y && cy <= y + h;
                if (overlaps) base.add(c.date);
              }
              setDraft(base);
            } else {
              const date = cellAtPoint(e.currentTarget, e.clientX, e.clientY);
              if (date) paintToggle(date);
            }
          }}
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
            const isSelected = effectiveSelected?.has(c.date) ?? false;
            // Colors strictly follow the legend (未入库 / 部分入库 / 全部入库):
            // no opacity modulation by article count, so every "未入库"
            // cell looks identical to the legend swatch regardless of
            // whether that day had 1 or 15 raw articles. Both dark and
            // light themes inherit via the CSS vars in tokens.css.
            const fill = allIngested
              ? "var(--accent)"
              : partial
              ? "var(--accent-soft)"
              : "var(--hair-strong)";
            const x = c.week * (cellSize + gap);
            const y = c.day * (cellSize + gap) + 16;
            return (
              <g key={i} pointerEvents="none">
                <rect
                  x={x}
                  y={y}
                  width={cellSize}
                  height={cellSize}
                  rx={2}
                  fill={fill}
                />
                {isSelected && (
                  // Draw the accent border inset by 0.5px so the stroke sits
                  // entirely inside the cell instead of bleeding 1px in each
                  // direction — avoids the visual mess where adjacent
                  // selected cells' outlines ran into the 2px inter-cell gap.
                  <rect
                    x={x + 0.5}
                    y={y + 0.5}
                    width={cellSize - 1}
                    height={cellSize - 1}
                    rx={1.5}
                    fill="none"
                    stroke="var(--accent)"
                    strokeWidth={1}
                  />
                )}
              </g>
            );
          })}
          {boxRect && (
            <rect
              x={boxRect.x}
              y={boxRect.y}
              width={boxRect.w}
              height={boxRect.h}
              fill="var(--accent)"
              fillOpacity={0.12}
              stroke="var(--accent)"
              strokeWidth={1}
              pointerEvents="none"
            />
          )}
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
        <span className="ml-auto text-[10px] text-[var(--faint)]">
          {(selectedDates?.size ?? 0) > 0
            ? <>已选 {selectedDates!.size} 天 · <button type="button" onClick={() => onClearDates?.()} className="text-[var(--accent)] hover:underline">清空</button></>
            : "点格子切换 · 按格子拖连选 · 按空白拖框选"}
        </span>
      </div>
    </div>
  );
}

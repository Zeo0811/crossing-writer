import ReactMarkdown from "react-markdown";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCandidates } from "../../hooks/useCandidates";
import { apiMission } from "../../api/client";
import { stripFrontmatter } from "../../utils/markdown";

export function MissionCandidatesPanel({
  projectId,
  onSelected,
}: {
  projectId: string;
  onSelected: () => void;
}) {
  const { data, isLoading } = useCandidates(projectId, true);
  const [busyIdx, setBusyIdx] = useState<number | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const qc = useQueryClient();

  async function pick(idx: number) {
    setBusyIdx(idx);
    try {
      await apiMission.select(projectId, idx);
      qc.invalidateQueries({ queryKey: ["projects", projectId] });
      onSelected();
    } finally {
      setBusyIdx(null);
    }
  }

  if (isLoading) return <div className="text-sm text-[var(--meta)]">候选加载中…</div>;
  if (!data) return <div className="text-sm text-[var(--meta)]">尚未产出候选</div>;

  const { body: stripped } = stripFrontmatter(data);
  const parts = stripped.split(/^# 候选 /m).slice(1);

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {parts.map((body, i) => {
          const idx = i + 1;
          const active = picked === idx;
          const lines = body.split("\n");
          const headLine = lines[0]?.trim() ?? `选题 ${idx}`;
          return (
            <button
              key={i}
              type="button"
              onClick={() => setPicked(idx)}
              className={`w-full text-left rounded p-4 border transition-colors ${
                active ? "border-[var(--accent)] bg-[var(--accent-fill)]" : "border-[var(--hair)] bg-[var(--bg-1)] hover:border-[var(--accent-soft)]"
              }`}
            >
              <div className="flex items-start gap-3">
                <span
                  className={`mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center ${
                    active ? "border-[var(--accent)] bg-[var(--accent)]" : "border-[var(--hair-strong)]"
                  }`}
                >
                  {active && <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-on)]" />}
                </span>
                <div className="flex-1 min-w-0">
                  <h3 className="text-[var(--heading)] font-semibold mb-2">候选 {headLine}</h3>
                  <div className="prose prose-sm max-w-none text-[var(--body)]">
                    <ReactMarkdown>{lines.slice(1).join("\n")}</ReactMarkdown>
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--meta)]">共 {parts.length} 个候选 · 单选其一</span>
        <button
          onClick={() => picked != null && pick(picked)}
          disabled={picked == null || busyIdx !== null}
          className="px-5 py-2 rounded border border-[var(--accent-soft)] bg-[var(--accent)] text-[var(--accent-on)] font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:shadow-[0_0_12px_var(--accent-dim)]"
        >
          {busyIdx ? "保存中…" : "选定该选题 →"}
        </button>
      </div>
    </div>
  );
}

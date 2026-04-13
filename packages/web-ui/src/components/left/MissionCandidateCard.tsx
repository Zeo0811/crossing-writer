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

  if (isLoading) return <div className="text-gray-500">候选加载中…</div>;
  if (!data) return <div className="text-gray-500">尚未产出候选</div>;

  // 剥 frontmatter，再按 "# 候选 " 分段（简化 parse；SP-03 再换 yaml parser）
  const { body: stripped } = stripFrontmatter(data);
  const parts = stripped.split(/^# 候选 /m).slice(1);
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">3 个候选 Mission</h2>
      {parts.map((body, i) => (
        <div
          key={i}
          className="p-4 bg-white rounded border"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-medium">候选 {body.split("\n")[0]}</h3>
            <button
              onClick={() => pick(i + 1)}
              disabled={busyIdx !== null}
              className="px-3 py-1 rounded text-white text-sm"
              style={{ background: "var(--green)" }}
            >
              {busyIdx === i + 1 ? "保存中…" : "采用这个"}
            </button>
          </div>
          <div className="prose max-w-none prose-sm">
            <ReactMarkdown>{`# 候选 ${body}`}</ReactMarkdown>
          </div>
        </div>
      ))}
    </div>
  );
}

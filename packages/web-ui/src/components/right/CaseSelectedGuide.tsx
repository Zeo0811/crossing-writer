import { useEffect, useState } from "react";
import { getSelectedCases } from "../../api/client";
import { EvidenceSection } from "../evidence/EvidenceSection";

export function CaseSelectedGuide({
  projectId,
  selectedCaseId,
  onSelectCase,
}: {
  projectId: string;
  selectedCaseId: string | null;
  onSelectCase: (caseId: string) => void;
}) {
  const [md, setMd] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    getSelectedCases(projectId).then(setMd);
  }, [projectId]);

  if (md === undefined) return <div className="text-sm text-[var(--meta)]">加载中…</div>;

  return (
    <div className="space-y-4">
      <div className="rounded bg-[var(--accent-fill)] border border-[var(--accent-soft)] p-3">
        <h3 className="text-sm font-semibold text-[var(--accent)]">Case Plan 已批准</h3>
        <p className="text-xs text-[var(--meta)] mt-1">下一步：去跑真实测，把截图/录屏/笔记传到每个 Case 下。</p>
      </div>
      <pre className="whitespace-pre-wrap text-xs text-[var(--body)] rounded bg-[var(--bg-2)] p-3 max-h-[300px] overflow-auto">{md}</pre>
      <EvidenceSection projectId={projectId} selectedCaseId={selectedCaseId} onSelectCase={onSelectCase} />
    </div>
  );
}

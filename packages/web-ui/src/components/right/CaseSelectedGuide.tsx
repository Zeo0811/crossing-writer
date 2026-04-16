import { useEffect, useState } from "react";
import { getSelectedCases } from "../../api/client";
import { EvidenceSection } from "../evidence/EvidenceSection";

export function CaseSelectedGuide({ projectId }: { projectId: string }) {
  const [md, setMd] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    getSelectedCases(projectId).then(setMd);
  }, [projectId]);

  if (md === undefined) return <div>加载中...</div>;

  return (
    <div className="p-4 space-y-4">
      <div className="bg-[var(--accent-fill)] border border-[var(--accent-soft)] p-3 rounded">
        <h3 className="font-semibold">Case Plan 已批准 ✅</h3>
        <p className="text-sm">下一步：<strong>去跑真实测</strong>，把截图/录屏/笔记传到每个 Case 下。</p>
      </div>
      <pre className="whitespace-pre-wrap text-xs">{md}</pre>
      <EvidenceSection projectId={projectId} />
    </div>
  );
}

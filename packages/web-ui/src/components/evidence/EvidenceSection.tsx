import { useProjectEvidence } from "../../hooks/useProjectEvidence";
import { submitEvidence } from "../../api/evidence-client";
import { CaseCompletenessBadge } from "./CaseCompletenessBadge";
import { ActionButton } from "../ui/ActionButton";

export function EvidenceSection({
  projectId,
  selectedCaseId,
  onSelectCase,
}: {
  projectId: string;
  selectedCaseId: string | null;
  onSelectCase: (caseId: string) => void;
}) {
  const { evidence, reload } = useProjectEvidence(projectId);

  if (!evidence) return <div className="text-xs text-gray-500">加载…</div>;

  const entries = Object.entries(evidence.cases);
  const completeCount = entries.filter(([, v]) => v.complete).length;
  const total = entries.length;

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {entries.map(([caseId, c]) => {
          const sel = caseId === selectedCaseId;
          return (
            <li
              key={caseId}
              data-testid={`case-row-${caseId}`}
              onClick={() => onSelectCase(caseId)}
              className={`cursor-pointer border p-2 rounded ${sel ? "border-blue-500 bg-blue-50" : ""}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-mono">{caseId}</span>
                <CaseCompletenessBadge completeness={{
                  complete: c.complete,
                  missing: [
                    !c.has_screenshot ? "screenshot" : null,
                    !c.has_notes ? "notes" : null,
                    !c.has_generated ? "generated" : null,
                  ].filter(Boolean) as any,
                  has_screenshot: c.has_screenshot,
                  has_notes: c.has_notes,
                  has_generated: c.has_generated,
                }} />
              </div>
              <div className="text-xs text-gray-500">
                {c.counts.screenshots} 截图 · {c.counts.recordings} 录屏 · {c.counts.generated} 产出
              </div>
            </li>
          );
        })}
      </ul>
      <div className="border-t pt-2 text-xs flex items-center justify-between">
        <span>进度：{completeCount}/{total} 完整</span>
        <ActionButton
          onClick={async () => { await submitEvidence(projectId); reload(); }}
          disabled={!evidence.all_complete || evidence.submitted_at !== null}
          successMsg="已提交 Evidence"
          errorMsg={(e) => `提交失败：${String(e)}`}
        >
          {evidence.submitted_at ? "已提交" : "提交 Evidence"}
        </ActionButton>
      </div>
    </div>
  );
}

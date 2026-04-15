import { useState } from "react";
import { useOverview } from "../../hooks/useOverview";
import { approveOverview } from "../../api/client";
import { ActionButton } from "../ui/ActionButton";

export function ProductOverviewCard({
  projectId, status,
}: { projectId: string; status: string }) {
  const { markdown, loading, save } = useOverview(projectId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  if (loading) return <div className="text-sm text-[var(--meta)]">加载中…</div>;
  if (markdown == null) return <div className="text-sm text-[var(--meta)]">概览尚未生成</div>;

  async function onSave() {
    await save(draft);
    setEditing(false);
  }

  return (
    <div className="space-y-3">
      {editing ? (
        <>
          <textarea
            className="w-full min-h-[320px] bg-[var(--bg-1)] border border-[var(--hair)] rounded p-3 text-sm text-[var(--body)] outline-none focus:border-[var(--accent-soft)] resize-y"
            style={{ fontFamily: "var(--font-mono)" }}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => setEditing(false)}
              className="px-3 py-1.5 text-xs text-[var(--meta)] hover:text-[var(--heading)]"
            >
              取消
            </button>
            <ActionButton onClick={onSave} successMsg="已保存" errorMsg={(e) => `保存失败：${String(e)}`}>
              保存
            </ActionButton>
          </div>
        </>
      ) : (
        <>
          <pre
            className="whitespace-pre-wrap text-sm text-[var(--body)] rounded bg-[var(--bg-1)] p-3 border border-[var(--hair)] max-h-[420px] overflow-auto"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {markdown}
          </pre>
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => { setDraft(markdown); setEditing(true); }}
              className="px-3 py-1.5 text-xs rounded border border-[var(--hair-strong)] text-[var(--meta)] hover:text-[var(--heading)]"
            >
              编辑
            </button>
            {status === "overview_ready" && (
              <ActionButton
                onClick={() => approveOverview(projectId)}
                successMsg="已批准"
                errorMsg={(e) => `批准失败：${String(e)}`}
              >
                批准进入 Case 规划 →
              </ActionButton>
            )}
          </div>
        </>
      )}
    </div>
  );
}

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

  if (loading) return <div>加载中...</div>;
  if (markdown == null) return <div>概览尚未生成</div>;

  async function onSave() {
    await save(draft);
    setEditing(false);
  }

  return (
    <div className="p-4">
      {editing ? (
        <>
          <textarea className="w-full h-80 border p-2 font-mono"
            value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div className="mt-2 flex gap-2">
            <ActionButton
              onClick={onSave}
              successMsg="已保存"
              errorMsg={(e) => `保存失败: ${String(e)}`}
            >
              保存
            </ActionButton>
            <button onClick={() => setEditing(false)}>取消</button>
          </div>
        </>
      ) : (
        <>
          <pre className="whitespace-pre-wrap">{markdown}</pre>
          <div className="mt-4 flex gap-2">
            <button onClick={() => { setDraft(markdown); setEditing(true); }}>
              编辑
            </button>
            {status === "overview_ready" && (
              <ActionButton
                onClick={() => approveOverview(projectId)}
                successMsg="已批准，进入 Case 规划"
                errorMsg={(e) => `批准失败: ${String(e)}`}
              >
                批准进入 Case 规划
              </ActionButton>
            )}
          </div>
        </>
      )}
    </div>
  );
}

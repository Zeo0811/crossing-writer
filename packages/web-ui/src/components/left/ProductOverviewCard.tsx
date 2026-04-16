import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { useOverview } from "../../hooks/useOverview";
import { approveOverview } from "../../api/client";
import { ActionButton } from "../ui/ActionButton";
import { stripFrontmatter } from "../../utils/markdown";

const OVERVIEW_CHIP_KEYS = [
  "product",
  "brand",
  "category",
  "stage",
  "target_user",
  "model_used",
];

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

  const { frontmatter, body } = stripFrontmatter(markdown);

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
          <article
            className="bg-[var(--bg-1)] p-6 rounded border max-h-[480px] overflow-auto"
            style={{ borderColor: "var(--hair)" }}
          >
            {Object.keys(frontmatter).length > 0 && (
              <dl className="flex flex-wrap gap-2 text-xs mb-4">
                {OVERVIEW_CHIP_KEYS
                  .filter((k) => frontmatter[k] && frontmatter[k] !== "null")
                  .map((k) => (
                    <span
                      key={k}
                      className="px-2 py-0.5 rounded border bg-[var(--bg-2)]"
                      style={{ borderColor: "var(--hair)" }}
                    >
                      <span className="text-[var(--meta)] mr-1">{k}:</span>
                      <span className="font-medium">{frontmatter[k]}</span>
                    </span>
                  ))}
              </dl>
            )}
            <div className="prose prose-sm max-w-none text-[var(--body)]">
              <ReactMarkdown>{body}</ReactMarkdown>
            </div>
          </article>
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

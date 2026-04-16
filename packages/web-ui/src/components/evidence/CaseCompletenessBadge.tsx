import type { CompletenessResult } from "../../api/evidence-client";

const LABEL: Record<string, string> = {
  screenshot: "截图",
  notes: "笔记",
  generated: "产出",
};

export function CaseCompletenessBadge({ completeness }: { completeness: CompletenessResult }) {
  const allEmpty = !completeness.has_screenshot && !completeness.has_notes && !completeness.has_generated;

  let text: string;
  let cls: string;

  if (completeness.complete) {
    text = "✅ 完整";
    cls = "bg-[var(--accent-fill)] text-[var(--accent)] border-[var(--accent-soft)]";
  } else if (allEmpty) {
    text = "待上传";
    cls = "bg-[var(--bg-2)] text-[var(--faint)] border-[var(--hair)]";
  } else {
    text = `⚠️ 缺 ${completeness.missing.map((m) => LABEL[m]).join("、")}`;
    cls = "bg-yellow-50 text-yellow-700 border-yellow-300";
  }

  return (
    <span
      data-testid="evidence-badge"
      className={`inline-block text-[10px] px-1.5 py-0.5 rounded border ${cls}`}
    >
      {text}
    </span>
  );
}

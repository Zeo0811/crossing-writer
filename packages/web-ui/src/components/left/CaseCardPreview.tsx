import type { ParsedCase } from "../../hooks/useCaseCandidates";

export function CaseCardPreview({ c }: { c: ParsedCase }) {
  // Strip the header line and known metadata fields already shown in the card header
  const body = c.rawBlock
    .replace(/^#[^\n]*\n/, "")
    .replace(/^(proposed_by|creativity_score|why_it_matters):[^\n]*\n?/gm, "")
    .trim();
  return (
    <details className="border-t mt-2">
      <summary className="cursor-pointer text-xs text-gray-600">展开详情</summary>
      <pre className="whitespace-pre-wrap text-xs mt-2">{body}</pre>
    </details>
  );
}

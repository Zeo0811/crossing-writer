import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { useCaseCandidates, type ParsedCase } from "../../hooks/useCaseCandidates";
import { selectCases } from "../../api/client";
import { ActionButton } from "../ui/ActionButton";

export function CaseListPanel({ projectId }: { projectId: string }) {
  const { cases, loading } = useCaseCandidates(projectId);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  if (loading) return <div className="text-sm text-[var(--meta)]">加载候选 Case…</div>;
  if (cases.length === 0) return <div className="text-sm text-[var(--meta)]">尚无 Case 候选</div>;

  function togglePick(idx: number) {
    setPicked((prev) => {
      const n = new Set(prev);
      if (n.has(idx)) n.delete(idx);
      else if (n.size < 4) n.add(idx);
      return n;
    });
  }

  function toggleExpand(idx: number) {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(idx)) n.delete(idx);
      else n.add(idx);
      return n;
    });
  }

  async function approve() {
    await selectCases(projectId, Array.from(picked).sort((a, b) => a - b));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--heading)]">
          {cases.length} 个候选 Case · 挑选 2-4 条带进正文
        </h3>
        <div className="text-xs text-[var(--meta)] font-mono-term">已选 {picked.size} / 4</div>
      </div>
      <div className="space-y-3">
        {cases.map((c) => (
          <CaseCard
            key={c.index}
            c={c}
            picked={picked.has(c.index)}
            expanded={expanded.has(c.index)}
            onTogglePick={() => togglePick(c.index)}
            onToggleExpand={() => toggleExpand(c.index)}
          />
        ))}
      </div>
      <div className="flex items-center justify-end gap-3 pt-2 border-t border-[var(--hair)]">
        <span className="text-xs text-[var(--meta)]">至少选 2 条</span>
        <ActionButton
          onClick={approve}
          disabled={picked.size < 2}
          successMsg="Case 已选定"
          errorMsg={(e) => `选定失败: ${String(e)}`}
        >
          批准这些 Case →
        </ActionButton>
      </div>
    </div>
  );
}

function CaseCard({
  c, picked, expanded, onTogglePick, onToggleExpand,
}: {
  c: ParsedCase;
  picked: boolean;
  expanded: boolean;
  onTogglePick: () => void;
  onToggleExpand: () => void;
}) {
  return (
    <div
      className={`rounded-lg border transition-colors ${
        picked ? "border-[var(--accent)] bg-[var(--accent-fill)]" : "border-[var(--hair)] bg-[var(--bg-1)]"
      }`}
    >
      {/* Header: checkbox + title + meta */}
      <div className="flex items-start gap-3 p-4">
        <button
          type="button"
          onClick={onTogglePick}
          className={`mt-0.5 shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
            picked ? "border-[var(--accent)] bg-[var(--accent)]" : "border-[var(--hair-strong)] bg-[var(--bg-1)] hover:border-[var(--accent-soft)]"
          }`}
          aria-label={picked ? `取消选中 Case ${c.index}` : `选中 Case ${c.index}`}
        >
          {picked && <span className="text-[var(--accent-on)] text-xs font-bold">✓</span>}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3 mb-2">
            <h4 className="text-[var(--heading)] font-semibold leading-snug">
              <span className="text-[var(--meta)] mr-1.5 font-mono-term text-sm">Case {String(c.index).padStart(2, "0")}</span>
              {c.name}
            </h4>
            {typeof c.creativityScore === "number" && (
              <span
                className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold font-mono-term ${
                  c.creativityScore >= 9 ? "bg-[var(--accent-fill)] text-[var(--accent)]" :
                  c.creativityScore >= 7 ? "bg-[var(--bg-2)] text-[var(--body)]" :
                  "bg-[var(--bg-2)] text-[var(--meta)]"
                }`}
                title="创意评分"
              >
                ★ {c.creativityScore}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 mb-2 text-[11px]">
            {c.proposedBy.length > 0 && c.proposedBy.map((p) => (
              <span key={p} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[var(--bg-2)] text-[var(--meta)]">
                <span className="text-[var(--faint)]">by</span>
                <span className="text-[var(--body)]">{p}</span>
              </span>
            ))}
            {c.supportsClaims.length > 0 && (
              <span className="text-[var(--faint)]">支持：</span>
            )}
            {c.supportsClaims.map((claim) => (
              <span key={claim} className="px-2 py-0.5 rounded bg-[var(--bg-2)] text-[var(--meta)] font-mono-term">
                {claim}
              </span>
            ))}
          </div>

          {c.whyItMatters && (
            <div className="mb-2 pl-3 border-l-2 border-[var(--accent-soft)]">
              <div className="text-[10px] uppercase tracking-wider text-[var(--accent)] font-semibold mb-1">为什么值得做</div>
              <p className="text-sm text-[var(--body)] leading-relaxed">
                {c.whyItMatters}
              </p>
            </div>
          )}

          <div className="flex items-center gap-4 text-[11px] text-[var(--faint)]">
            <span>{c.steps.length} 步</span>
            <span>·</span>
            <span>{c.prompts.length} 条 prompt</span>
            <span>·</span>
            <span>{c.expectedMedia.length} 项素材</span>
            <span>·</span>
            <span>{c.risks.length} 项风险</span>
            <button
              type="button"
              onClick={onToggleExpand}
              className="ml-auto inline-flex items-center gap-1 text-[var(--accent)] hover:underline"
              data-testid={`case-expand-${c.index}`}
            >
              {expanded ? "收起" : "展开详情"} {expanded ? "▴" : "▾"}
            </button>
          </div>
        </div>
      </div>

      {expanded && <CaseDetails c={c} />}
    </div>
  );
}

function CaseDetails({ c }: { c: ParsedCase }) {
  return (
    <div className="border-t border-[var(--hair)] bg-[var(--bg-0)] p-5 space-y-5 text-sm text-[var(--body)]">
      {c.steps.length > 0 && (
        <Section title="步骤" count={c.steps.length}>
          <ol className="space-y-2">
            {c.steps.map((s) => (
              <li key={s.step} className="flex items-start gap-3">
                <span className="shrink-0 w-6 h-6 rounded-full bg-[var(--bg-2)] text-[var(--accent)] font-mono-term text-xs flex items-center justify-center font-semibold">
                  {s.step}
                </span>
                <div className="flex-1">
                  <p className="text-[var(--body)] leading-relaxed">{s.action}</p>
                  {s.prep_required && (
                    <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded bg-[var(--amber)] text-[var(--amber-on,var(--bg-0))] font-mono-term">需准备</span>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {c.prompts.length > 0 && (
        <Section title="示范 Prompt" count={c.prompts.length}>
          <div className="space-y-3">
            {c.prompts.map((p, i) => (
              <div key={i} className="rounded bg-[var(--bg-1)] border border-[var(--hair)] overflow-hidden">
                <div className="px-3 py-1.5 text-[11px] text-[var(--meta)] bg-[var(--bg-2)] border-b border-[var(--hair)]">
                  {p.purpose}
                </div>
                <pre className="px-3 py-2 text-xs text-[var(--body)] whitespace-pre-wrap break-words font-mono-term leading-relaxed">
                  {p.text}
                </pre>
              </div>
            ))}
          </div>
        </Section>
      )}

      {c.expectedMedia.length > 0 && (
        <Section title="预期素材" count={c.expectedMedia.length}>
          <ul className="space-y-1.5">
            {c.expectedMedia.map((m, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-2)] text-[var(--accent)] font-semibold uppercase tracking-wider font-mono-term">
                  {m.kind}
                </span>
                <span className="text-[var(--body)] leading-relaxed">
                  {m.spec ? formatSpec(m.spec) : ""}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {c.observationPoints.length > 0 && (
        <Section title="观察点" count={c.observationPoints.length}>
          <ul className="space-y-1.5 list-disc list-inside leading-relaxed">
            {c.observationPoints.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        </Section>
      )}

      {(c.screenshotPoints.length > 0 || c.recordingPoints.length > 0) && (
        <div className="grid grid-cols-2 gap-4">
          {c.screenshotPoints.length > 0 && (
            <Section title="截图点" count={c.screenshotPoints.length}>
              <ul className="space-y-1 list-disc list-inside leading-relaxed">
                {c.screenshotPoints.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            </Section>
          )}
          {c.recordingPoints.length > 0 && (
            <Section title="录制点" count={c.recordingPoints.length}>
              <ul className="space-y-1 list-disc list-inside leading-relaxed">
                {c.recordingPoints.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            </Section>
          )}
        </div>
      )}

      {c.risks.length > 0 && (
        <Section title="风险" count={c.risks.length} tone="red">
          <ul className="space-y-1.5">
            {c.risks.map((r, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="shrink-0 text-[var(--red)]">⚠</span>
                <span className="leading-relaxed">{r}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {c.predictedOutcome && (
        <Section title="预测结果">
          <div className="leading-relaxed">
            <ReactMarkdown>{c.predictedOutcome}</ReactMarkdown>
          </div>
        </Section>
      )}

      {c.inspiredBy.length > 0 && (
        <Section title="灵感来源" count={c.inspiredBy.length}>
          <ul className="space-y-2">
            {c.inspiredBy.map((ib, i) => (
              <li key={i}>
                <div className="text-[var(--accent)] text-[11px] font-mono-term leading-snug">{ib.ref_path}</div>
                <div className="text-[var(--meta)] text-xs pl-3 leading-relaxed">借鉴：{ib.what_borrowed}</div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {c.narrative && (
        <Section title="详细说明">
          <div className="prose prose-sm max-w-none leading-relaxed prose-headings:text-[var(--heading)] prose-strong:text-[var(--heading)] prose-p:text-[var(--body)] prose-li:text-[var(--body)]">
            <ReactMarkdown>{c.narrative}</ReactMarkdown>
          </div>
        </Section>
      )}
    </div>
  );
}

function Section({
  title, count, tone, children,
}: {
  title: string;
  count?: number;
  tone?: "red";
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-2">
        <h5 className={`text-[11px] uppercase tracking-wider font-semibold ${tone === "red" ? "text-[var(--red)]" : "text-[var(--meta)]"}`}>
          {title}
        </h5>
        {typeof count === "number" && (
          <span className="text-[10px] text-[var(--faint)] font-mono-term">{count}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function formatSpec(spec: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(spec)) {
    if (v == null || v === "") continue;
    if (typeof v === "boolean") parts.push(`${k}=${v}`);
    else parts.push(`${k}: ${String(v)}`);
  }
  return parts.join(" · ");
}

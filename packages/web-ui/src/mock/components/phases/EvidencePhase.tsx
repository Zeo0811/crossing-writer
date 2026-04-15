import { useState } from "react";
import { useMock } from "../../MockProvider";
import { CASE_CANDIDATES } from "../../fixtures/candidates";

interface EvidenceCase {
  id: string;
  title: string;
  screenshots: number;
  recordings: number;
  notes: string;
  hasNotes: boolean;
}

const INITIAL_CASES: EvidenceCase[] = CASE_CANDIDATES.filter((c) => c.selected).map((c, i) => ({
  id: c.id,
  title: c.title,
  screenshots: i === 0 ? 4 : i === 1 ? 2 : 0,
  recordings: i === 0 ? 1 : 0,
  hasNotes: i === 0,
  notes: i === 0 ? "Cursor 在解析旧脚本时，自动识别了 sqlite 依赖；2 步给出 FastAPI scaffold。" : "",
}));

export function EvidencePhase() {
  const m = useMock();
  if (m.heroStatus === "evidence_collecting") return <EvidenceCollecting />;
  if (m.heroStatus === "evidence_ready") return <EvidenceReady />;
  return null;
}

function EvidenceCollecting() {
  const m = useMock();
  const [cases] = useState(INITIAL_CASES);
  const [openCase, setOpenCase] = useState<string | null>(cases[0]?.id ?? null);
  const completion = cases.map((c) => c.screenshots > 0 && c.hasNotes);
  const completed = completion.filter(Boolean).length;
  function submit() {
    if (completed < cases.length) {
      m.pushToast({ type: "error", message: "还有 Case 未齐：每个 Case 至少 1 张截图 + 1 条笔记" });
      return;
    }
    m.setHeroStatus("evidence_ready");
    m.pushToast({ type: "success", message: "实测素材已提交" });
  }
  return (
    <div className="grid grid-cols-[260px_1fr] gap-5">
      <aside className="space-y-1.5">
        <div className="flex items-center justify-between mb-2 text-xs">
          <span className="text-[var(--meta)] font-semibold">Cases</span>
          <span className="text-[var(--faint)]">{completed} / {cases.length}</span>
        </div>
        {cases.map((c, i) => {
          const done = completion[i];
          const active = openCase === c.id;
          return (
            <button
              key={c.id}
              onClick={() => setOpenCase(c.id)}
              className={`w-full text-left p-2.5 rounded text-xs flex items-center gap-2 ${
                active ? "bg-[var(--accent-fill)] text-[var(--heading)]" : "bg-[var(--bg-2)] text-[var(--body)] hover:bg-[var(--bg-1)]"
              }`}
            >
              <span className={`w-4 h-4 rounded-sm border flex items-center justify-center text-[9px] ${done ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-on)]" : "border-[var(--hair-strong)] text-[var(--faint)]"}`}>
                {done ? "✓" : i + 1}
              </span>
              <span className="flex-1 truncate">{c.title}</span>
            </button>
          );
        })}
        <div className="pt-3">
          <button onClick={submit} className="w-full px-3 py-2 rounded border border-[var(--accent-soft)] bg-[var(--accent)] text-[var(--accent-on)] text-sm font-semibold disabled:opacity-50">提交进入创作 →</button>
        </div>
      </aside>
      <main>
        {openCase ? <CaseDetail c={cases.find((c) => c.id === openCase)!} /> : <div className="text-[var(--meta)] text-sm">挑一个 Case 开始上传素材</div>}
      </main>
    </div>
  );
}

function CaseDetail({ c }: { c: EvidenceCase }) {
  return (
    <div className="space-y-4">
      <div className="rounded bg-[var(--bg-2)] p-4">
        <div className="text-[var(--heading)] font-semibold text-sm mb-1">{c.title}</div>
        <div className="text-xs text-[var(--meta)]">{c.screenshots} 张截图 · {c.recordings} 段录屏 · 笔记 {c.hasNotes ? "✓" : "—"}</div>
      </div>
      <Section title="截图" count={c.screenshots} cta="上传截图">
        {c.screenshots > 0 ? (
          <div className="grid grid-cols-4 gap-2">
            {Array.from({ length: c.screenshots }).map((_, i) => (
              <div key={i} className="aspect-video rounded bg-[var(--bg-1)] border border-[var(--hair)] flex items-center justify-center text-3xl text-[var(--faint)]">🖼</div>
            ))}
          </div>
        ) : (
          <DropHint hint="拖入截图，可批量。最多 10MB / 张" />
        )}
      </Section>
      <Section title="录屏" count={c.recordings} cta="上传录屏">
        {c.recordings > 0 ? (
          <div className="rounded bg-[var(--bg-1)] border border-[var(--hair)] p-3 flex items-center gap-3">
            <span className="w-12 h-12 rounded bg-[var(--bg-2)] flex items-center justify-center text-2xl">🎬</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm">cursor-quickstart.mov</div>
              <div className="text-xs text-[var(--faint)]">02:34 · 18.2 MB</div>
            </div>
          </div>
        ) : (
          <DropHint hint="拖入 mp4 / mov / webm。最多 100MB" />
        )}
      </Section>
      <Section title="实测笔记" count={c.hasNotes ? 1 : 0} cta="编辑笔记">
        {c.hasNotes ? (
          <div className="rounded bg-[var(--bg-1)] border border-[var(--hair)] p-3 text-sm text-[var(--body)]">
            {c.notes}
            <div className="mt-2 text-[10px] text-[var(--faint)]">含 frontmatter（type, case_id, ran_at, observations[]）</div>
          </div>
        ) : (
          <div className="rounded bg-[var(--bg-1)] border border-dashed border-[var(--hair-strong)] p-6 text-center text-sm text-[var(--meta)]">
            还没写笔记。点击「编辑笔记」开始记录关键观察点（亮点 / 卡点 / 量化指标）。
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({ title, count, cta, children }: { title: string; count: number; cta: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[var(--heading)]">{title} <span className="text-[var(--faint)] text-xs ml-1">{count}</span></div>
        <button className="text-xs text-[var(--accent)] hover:underline">＋ {cta}</button>
      </div>
      {children}
    </div>
  );
}

function DropHint({ hint }: { hint: string }) {
  return (
    <div className="rounded bg-[var(--bg-1)] border border-dashed border-[var(--hair-strong)] py-8 flex flex-col items-center gap-1.5 text-[var(--meta)] text-sm hover:border-[var(--accent-soft)] cursor-pointer">
      <span className="text-2xl text-[var(--accent)]">⇣</span>
      <span>{hint}</span>
    </div>
  );
}

function EvidenceReady() {
  const m = useMock();
  return (
    <div className="rounded border border-[var(--accent-soft)] bg-[var(--accent-fill)] p-4 flex items-center gap-3">
      <span className="text-2xl text-[var(--accent)]">✓</span>
      <div className="flex-1">
        <div className="text-sm text-[var(--accent)] font-semibold">实测素材已齐</div>
        <div className="text-xs text-[var(--meta)]">下一步：进入创作配置，挑作者风格 / 写作专家。</div>
      </div>
      <button onClick={() => m.setHeroStatus("writing_configuring")} className="px-4 py-2 rounded bg-[var(--accent)] text-[var(--accent-on)] text-sm font-semibold">进入创作 →</button>
    </div>
  );
}

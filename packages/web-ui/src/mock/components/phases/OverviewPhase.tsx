import { useState } from "react";
import { useMock } from "../../MockProvider";

export function OverviewPhase() {
  const m = useMock();
  switch (m.heroStatus) {
    case "awaiting_overview_input":
      return <OverviewInput />;
    case "overview_analyzing":
      return <OverviewAnalyzing />;
    case "overview_failed":
      return <OverviewFailed />;
    case "overview_ready":
      return <OverviewReady />;
    default:
      return null;
  }
}

function OverviewInput() {
  const m = useMock();
  const [official, setOfficial] = useState("https://cursor.sh");
  const [docs, setDocs] = useState("https://cursor.sh/docs");
  const [trial, setTrial] = useState("https://cursor.sh/download");
  const [notes, setNotes] = useState("");

  function submit() {
    m.setHeroStatus("overview_analyzing");
    m.pushToast({ type: "info", message: "正在抓取并归纳…" });
    setTimeout(() => {
      m.setHeroStatus("overview_ready");
      m.pushToast({ type: "success", message: "产品概览已生成" });
    }, 2500);
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="官方网站" v={official} set={setOfficial} ph="https://" />
        <Field label="文档地址" v={docs} set={setDocs} ph="https://" />
        <Field label="试用 / 下载链接" v={trial} set={setTrial} ph="https://" />
        <Field label="附加说明" v={notes} set={setNotes} ph="想强调的角度…" />
      </div>
      <div className="rounded bg-[var(--bg-2)] p-4">
        <div className="text-xs text-[var(--meta)] mb-2 font-semibold">补充图片 / 截图（可选）</div>
        <div className="border border-dashed border-[var(--hair-strong)] rounded py-8 flex flex-col items-center justify-center gap-1.5 text-[var(--meta)] text-sm hover:border-[var(--accent-soft)] hover:bg-[var(--bg-1)] cursor-pointer">
          <span className="text-2xl text-[var(--accent)]">⇣</span>
          <span>拖入截图，或点击选择</span>
          <span className="text-xs text-[var(--faint)]">概览生成时会一并参考</span>
        </div>
      </div>
      <div className="flex justify-end">
        <button
          onClick={submit}
          className="px-5 py-2 rounded border border-[var(--accent-soft)] bg-[var(--accent)] text-[var(--accent-on)] font-semibold"
        >
          生成产品概览 →
        </button>
      </div>
    </div>
  );
}

function OverviewAnalyzing() {
  return (
    <div className="rounded bg-[var(--bg-2)] p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-[var(--heading)] font-semibold">正在抓取并归纳…</div>
        <span className="text-xs text-[var(--meta)]">Overview Analyst · claude-opus-4-6</span>
      </div>
      <div className="space-y-2">
        {[85, 70, 92, 60, 78].map((w, i) => (
          <span key={i} className="block h-3 rounded bg-[var(--bg-1)] overflow-hidden">
            <span className="block h-full bg-[var(--accent-fill)] animate-pulse" style={{ width: `${w}%`, animationDelay: `${i * 0.12}s` }} />
          </span>
        ))}
      </div>
    </div>
  );
}

function OverviewFailed() {
  const m = useMock();
  return (
    <div className="rounded border border-[var(--red)] bg-[rgba(255,107,107,0.05)] p-6 space-y-4">
      <div className="text-[var(--red)] font-semibold">概览生成失败</div>
      <p className="text-sm text-[var(--body)]">claude CLI 退出码 1：fetch https://cursor.sh 超时（30s）。</p>
      <button onClick={() => m.setHeroStatus("overview_analyzing")} className="px-4 py-2 rounded bg-[var(--accent)] text-[var(--accent-on)] text-sm font-semibold">重试</button>
    </div>
  );
}

function OverviewReady() {
  const m = useMock();
  return (
    <div className="space-y-4">
      <div className="rounded border border-[var(--accent-soft)] bg-[var(--accent-fill)] p-4 flex items-center gap-3">
        <span className="text-2xl text-[var(--accent)]">✓</span>
        <div className="flex-1">
          <div className="text-sm text-[var(--accent)] font-semibold">产品概览已生成</div>
          <div className="text-xs text-[var(--meta)]">下一步：挑一位 Case 专家规划真实测体验。</div>
        </div>
        <button
          onClick={() => m.setHeroStatus("awaiting_case_expert_selection")}
          className="px-4 py-2 rounded bg-[var(--accent)] text-[var(--accent-on)] text-sm font-semibold"
        >
          挑 Case 专家 →
        </button>
      </div>
      <div className="rounded bg-[var(--bg-2)] p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs text-[var(--meta)] font-semibold">overview.md</div>
          <button onClick={() => { m.setHeroStatus("overview_analyzing"); setTimeout(() => m.setHeroStatus("overview_ready"), 1800); }} className="text-xs text-[var(--accent)] hover:underline">重新生成</button>
        </div>
        <div className="prose prose-sm max-w-none text-sm">
          <h3 className="text-[var(--heading)]">Cursor IDE 一句话总结</h3>
          <p className="text-[var(--body)]">
            把 AI 当 IDE 内同事的"AI-first 编辑器"，原生集成 Claude / GPT 多 agent，可在多文件上下文里独立完成 PR 级任务。
          </p>
          <h3 className="text-[var(--heading)]">关键差异</h3>
          <ul className="text-[var(--body)]">
            <li>多文件 agent 模式 vs Copilot 行级补全</li>
            <li>命令工具内置（terminal / git / web）</li>
            <li>Composer 直接产生 PR 草稿</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function Field({ label, v, set, ph }: { label: string; v: string; set: (s: string) => void; ph: string }) {
  return (
    <label className="block">
      <span className="text-xs text-[var(--meta)] block mb-1">{label}</span>
      <input
        value={v}
        onChange={(e) => set(e.target.value)}
        placeholder={ph}
        className="w-full bg-[var(--bg-2)] border border-[var(--hair)] rounded px-3 py-2 text-sm text-[var(--body)] outline-none focus:border-[var(--accent-soft)]"
      />
    </label>
  );
}

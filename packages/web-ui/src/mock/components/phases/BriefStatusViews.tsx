import { useMock } from "../../MockProvider";

export function BriefUploadingView() {
  return (
    <div className="rounded bg-[var(--bg-2)] p-8 text-center space-y-4">
      <h2 className="text-base text-[var(--heading)] font-semibold">正在上传…</h2>
      <div className="max-w-[420px] mx-auto h-2 rounded-sm bg-[var(--bg-2)] overflow-hidden">
        <div className="h-full bg-[var(--accent)] animate-[pulse_1.2s_ease-in-out_infinite]" style={{ width: "62%" }} />
      </div>
      <p className="text-xs text-[var(--faint)]">brief-cursor.pdf · 2.4 MB</p>
    </div>
  );
}

export function BriefAnalyzingView() {
  return (
    <div className="rounded bg-[var(--bg-2)] p-8 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base text-[var(--heading)] font-semibold">正在解析…</h2>
        <span className="text-xs text-[var(--meta)]">Brief Analyst · claude-opus-4-7</span>
      </div>
      <div className="space-y-2">
        {[80, 60, 90, 50, 70].map((w, i) => (
          <div key={i} className="h-3 rounded-sm bg-[var(--bg-2)] overflow-hidden">
            <div className="h-full bg-[var(--accent-fill)] animate-pulse" style={{ width: `${w}%`, animationDelay: `${i * 0.1}s` }} />
          </div>
        ))}
      </div>
      <div className="text-xs text-[var(--meta)] flex items-center gap-1.5 pt-2">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
        正在抽取产品名 / 调性 / 卖点…
      </div>
    </div>
  );
}

export function BriefReadyView() {
  const m = useMock();
  return (
    <div className="space-y-4">
      <div className="rounded border border-[var(--accent-soft)] bg-[var(--accent-fill)] p-4 flex items-center gap-3">
        <span className="text-2xl text-[var(--accent)]">✓</span>
        <div className="flex-1">
          <div className="text-sm text-[var(--accent)] font-semibold">Brief 解析完成</div>
          <div className="text-xs text-[var(--meta)]">下一步：挑一位 Mission 专家开始第一轮选题。</div>
        </div>
        <button
          onClick={() => m.setHeroStatus("awaiting_expert_selection")}
          className="px-4 py-2 rounded bg-[var(--accent)] text-[var(--accent-on)] text-sm font-semibold"
        >
          挑专家 →
        </button>
      </div>

      <div className="rounded bg-[var(--bg-2)] p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs text-[var(--meta)] font-semibold">brief.md</div>
          <button
            onClick={() => { m.setHeroStatus("brief_analyzing"); m.pushToast({ type: "info", message: "正在重新解析…" }); setTimeout(() => m.setHeroStatus("brief_ready"), 1500); }}
            className="text-xs text-[var(--accent)] hover:underline"
          >
            重新解析
          </button>
        </div>
        <div className="prose prose-sm max-w-none text-sm">
          <h3 className="text-[var(--heading)]">Cursor IDE 评测 brief（精炼）</h3>
          <ul className="text-[var(--body)]">
            <li><strong>产品</strong>：Cursor IDE — AI 原生编辑器</li>
            <li><strong>核心卖点</strong>：原生集成 Claude / GPT，多文件 agent</li>
            <li><strong>目标读者</strong>：独立开发者 + AI 应用工程师</li>
            <li><strong>调性</strong>：第一人称深度体验，避免营销话术</li>
            <li><strong>必带角度</strong>：人类仍是主驾的克制感</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export function BriefFailedView() {
  const m = useMock();
  return (
    <div className="rounded border border-[var(--red)] bg-[rgba(255,107,107,0.05)] p-6 space-y-4">
      <div className="flex items-start gap-3">
        <span className="text-2xl text-[var(--red)]">⚠</span>
        <div className="flex-1">
          <div className="text-[var(--red)] font-semibold mb-1">Brief 解析失败</div>
          <p className="text-sm text-[var(--body)]">Brief Analyst (claude) 退出码 1：claude CLI 沙箱拒绝读取 vault 文件。</p>
        </div>
      </div>
      <pre className="rounded-sm bg-[var(--log-bg)] border border-[var(--hair)] p-3 text-[11px] text-[var(--body)] overflow-x-auto" style={{ fontFamily: "var(--font-mono)" }}>
{`$ claude -p - --tools "" --add-dir /Users/zeoooo/.crossing/vault
[error] permission denied reading /Users/zeoooo/.crossing/vault/brief/raw/brief.pdf
exit code: 1`}
      </pre>
      <div className="flex items-center gap-2">
        <button
          onClick={() => { m.setHeroStatus("brief_analyzing"); setTimeout(() => m.setHeroStatus("brief_ready"), 1500); }}
          className="px-4 py-2 rounded bg-[var(--accent)] text-[var(--accent-on)] text-sm font-semibold"
        >
          重新解析
        </button>
        <button
          onClick={() => m.setHeroStatus("created")}
          className="px-4 py-2 rounded border border-[var(--hair-strong)] text-[var(--meta)] hover:text-[var(--heading)] text-sm"
        >
          重新上传 Brief
        </button>
      </div>
    </div>
  );
}

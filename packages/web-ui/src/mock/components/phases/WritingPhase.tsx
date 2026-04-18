import { useState } from "react";
import { useMock } from "../../MockProvider";

const SECTIONS = [
  { key: "opening", label: "开篇" },
  { key: "case-01", label: "Case 01 · 旧脚本改 Web 服务" },
  { key: "case-02", label: "Case 02 · 复现 issue 提 PR" },
  { key: "case-03", label: "Case 03 · 论文落 demo" },
  { key: "closing", label: "收束" },
];

export function WritingPhase() {
  const m = useMock();
  switch (m.heroStatus) {
    case "writing_configuring":
      return <WritingConfig />;
    case "writing_running":
      return <WritingRunning />;
    case "writing_failed":
      return <WritingFailed />;
    case "writing_ready":
    case "writing_editing":
      return <WritingDraft />;
    default:
      return null;
  }
}

function WritingConfig() {
  const m = useMock();
  const [voice, setVoice] = useState("十字路口·克制深度");
  const [refs, setRefs] = useState("@KojiTalks @TopGeeky @独立开发拾遗");
  const [model, setModel] = useState("claude-opus-4-7");
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="作者风格" v={voice} set={setVoice} />
        <Field label="模型" v={model} set={setModel} />
        <div className="col-span-2">
          <Field label="参考公众号 (@-mention 多个，空格分隔)" v={refs} set={setRefs} />
        </div>
      </div>
      <div className="rounded bg-[var(--bg-2)] p-4">
        <div className="text-xs text-[var(--meta)] mb-2 font-semibold">已选 Case（自动带入正文）</div>
        <ul className="text-sm space-y-1.5">
          {SECTIONS.filter((s) => s.key.startsWith("case")).map((s) => (
            <li key={s.key} className="flex items-center gap-2 text-[var(--body)]">
              <span className="text-[var(--accent)]">✓</span>
              {s.label}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex justify-end">
        <button
          onClick={() => {
            m.setHeroStatus("writing_running");
            m.pushToast({ type: "info", message: "Writer 正在生成…" });
            setTimeout(() => { m.setHeroStatus("writing_ready"); m.pushToast({ type: "success", message: "初稿就绪" }); }, 3000);
          }}
          className="px-5 py-2 rounded border border-[var(--accent-soft)] bg-[var(--accent)] text-[var(--accent-on)] font-semibold"
        >
          开始写稿 →
        </button>
      </div>
    </div>
  );
}

function WritingRunning() {
  return (
    <div className="rounded bg-[var(--bg-2)] p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-[var(--heading)] font-semibold">Writer 正在分段生成…</div>
        <span className="text-xs text-[var(--meta)]">claude-opus-4-7 · 5-10 分钟</span>
      </div>
      <div className="space-y-1.5">
        {SECTIONS.map((s, i) => {
          const done = i < 2;
          const active = i === 2;
          return (
            <div key={s.key} className="flex items-center gap-3 px-3 py-2 rounded bg-[var(--bg-1)] text-sm">
              <span className={`w-4 h-4 rounded-sm flex items-center justify-center text-[10px] ${
                done ? "bg-[var(--accent)] text-[var(--accent-on)]" : active ? "bg-[var(--amber)] text-[var(--accent-on)] animate-pulse" : "bg-[var(--bg-2)] text-[var(--faint)]"
              }`}>
                {done ? "✓" : i + 1}
              </span>
              <span className={done ? "text-[var(--meta)]" : active ? "text-[var(--heading)] font-semibold" : "text-[var(--faint)]"}>{s.label}</span>
              {active && <span className="ml-auto text-[10px] text-[var(--amber)]" style={{ fontFamily: "var(--font-mono)" }}>streaming</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WritingFailed() {
  const m = useMock();
  return (
    <div className="rounded border border-[var(--red)] bg-[rgba(255,107,107,0.05)] p-6 space-y-4">
      <div className="text-[var(--red)] font-semibold">写稿失败</div>
      <p className="text-sm">case-02 段落超 10K tokens 失败，前 1 段已保存。</p>
      <div className="flex gap-2">
        <button onClick={() => m.setHeroStatus("writing_running")} className="px-4 py-2 rounded bg-[var(--accent)] text-[var(--accent-on)] text-sm font-semibold">仅重跑 case-02</button>
        <button onClick={() => m.setHeroStatus("writing_configuring")} className="px-4 py-2 rounded border border-[var(--hair-strong)] text-[var(--meta)] text-sm">改配置</button>
      </div>
    </div>
  );
}

function WritingDraft() {
  const m = useMock();
  const [activeSection, setActiveSection] = useState("opening");
  const [showRewrite, setShowRewrite] = useState(false);
  return (
    <div className="grid grid-cols-[200px_1fr] gap-5">
      <aside className="space-y-1.5">
        <div className="text-xs text-[var(--meta)] font-semibold mb-2">段落</div>
        {SECTIONS.map((s) => {
          const active = activeSection === s.key;
          return (
            <button
              key={s.key}
              onClick={() => setActiveSection(s.key)}
              className={`w-full text-left px-2.5 py-2 rounded text-xs flex items-center gap-2 ${
                active ? "bg-[var(--accent-fill)] text-[var(--heading)]" : "text-[var(--body)] hover:bg-[var(--bg-2)]"
              }`}
            >
              <span className="text-[var(--accent)]">✓</span>
              <span className="flex-1 truncate">{s.label}</span>
            </button>
          );
        })}
        <div className="pt-3 space-y-2">
          <button className="w-full px-3 py-2 rounded border border-[var(--hair)] text-xs text-[var(--meta)] hover:text-[var(--heading)]">复制 markdown</button>
          <button className="w-full px-3 py-2 rounded bg-[var(--accent)] text-[var(--accent-on)] text-xs font-semibold">发布到微信草稿</button>
        </div>
      </aside>
      <main className="space-y-3">
        <div className="rounded bg-[var(--bg-2)] p-5 prose prose-sm max-w-none text-[var(--body)] relative min-h-[280px]">
          <h2 className="text-[var(--heading)]">{SECTIONS.find((s) => s.key === activeSection)?.label}</h2>
          <p>这里是 <mark className="bg-[var(--accent-fill)] text-[var(--heading)] px-1 rounded-sm cursor-pointer" onClick={() => setShowRewrite(true)}>选中这一段试试改写</mark>，点击橙色高亮即可弹出 rewrite 浮层。</p>
          <p>Cursor 这一年的最大变化，不是它"更聪明"，而是它的 agent 终于够得上"接管整段任务"。我把一个 200 行的 Python 老脚本扔给它，没说一句话，30 秒它就回了一句：「我看到了 sqlite，要不要顺手把它拆成 FastAPI？」我点了同意。</p>
          <p>从那一刻起，我不是在写代码，我是在审稿。</p>
        </div>
        {showRewrite && <SelectionRewrite onClose={() => setShowRewrite(false)} />}
        <div className="flex items-center justify-between text-xs text-[var(--meta)]">
          <span>已编辑 · 自动保存 · 12 秒前</span>
          <div className="flex gap-2">
            <button className="px-3 py-1 rounded border border-[var(--hair-strong)] hover:text-[var(--heading)]">@-mention skill</button>
            <button onClick={() => m.pushToast({ type: "info", message: "正在重新合稿…" })} className="px-3 py-1 rounded border border-[var(--hair-strong)] hover:text-[var(--heading)]">重新合稿</button>
          </div>
        </div>
      </main>
    </div>
  );
}

function SelectionRewrite({ onClose }: { onClose: () => void }) {
  return (
    <div className="rounded border border-[var(--accent-soft)] bg-[var(--bg-1)] p-3 shadow-lg">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-[var(--accent)] font-semibold">改写所选片段</div>
        <button onClick={onClose} className="text-[var(--meta)] text-xs">✕</button>
      </div>
      <div className="flex items-center gap-2">
        <input
          autoFocus
          placeholder="输入指令，回车提交（例：更口语 / 更短 / 加一个数据点）"
          onKeyDown={(e) => { if (e.key === "Enter") { onClose(); } }}
          className="flex-1 bg-[var(--bg-2)] border border-[var(--hair)] rounded px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
        />
        <button className="px-3 py-2 rounded bg-[var(--accent)] text-[var(--accent-on)] text-xs font-semibold">改写</button>
      </div>
    </div>
  );
}

function Field({ label, v, set }: { label: string; v: string; set: (s: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs text-[var(--meta)] block mb-1">{label}</span>
      <input
        value={v}
        onChange={(e) => set(e.target.value)}
        className="w-full bg-[var(--bg-2)] border border-[var(--hair)] rounded px-3 py-2 text-sm text-[var(--body)] outline-none focus:border-[var(--accent-soft)]"
      />
    </label>
  );
}

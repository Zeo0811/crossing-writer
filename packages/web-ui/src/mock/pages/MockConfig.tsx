import { useState } from "react";

interface AgentRow {
  id: string;
  name: string;
  role: string;
  cli: "claude" | "codex";
  model: string;
  status: "ready" | "needs_review" | "running";
}

const AGENTS: AgentRow[] = [
  { id: "brief-analyst", name: "Brief Analyst", role: "解析甲方简报", cli: "claude", model: "claude-opus-4-6", status: "ready" },
  { id: "mission-coord", name: "Mission Coordinator", role: "选题协调", cli: "claude", model: "claude-sonnet-4-6", status: "ready" },
  { id: "mission-narrative", name: "Mission · 故事派", role: "选题候选", cli: "claude", model: "claude-opus-4-6", status: "ready" },
  { id: "mission-systems", name: "Mission · 拆解派", role: "选题候选", cli: "claude", model: "claude-sonnet-4-6", status: "needs_review" },
  { id: "mission-zeitgeist", name: "Mission · 时代派", role: "选题候选", cli: "codex", model: "gpt-5-thinking", status: "ready" },
  { id: "overview-analyst", name: "Overview Analyst", role: "产品概览", cli: "claude", model: "claude-opus-4-6", status: "ready" },
  { id: "case-firsttouch", name: "Case · 首次接触", role: "Case 规划", cli: "claude", model: "claude-opus-4-6", status: "ready" },
  { id: "writer", name: "Writer", role: "正文创作", cli: "claude", model: "claude-opus-4-6", status: "running" },
];

export function MockConfig() {
  const [tab, setTab] = useState<"agents" | "models" | "tools">("agents");
  return (
    <div className="rounded border border-[var(--hair)] bg-[var(--bg-1)] overflow-hidden">
      <header className="flex items-center justify-between px-6 h-12 border-b border-[var(--hair)]">
        <h1 className="text-base text-[var(--heading)] font-semibold">配置</h1>
        <button className="px-3 py-1.5 rounded border border-[var(--accent-soft)] bg-[var(--accent)] text-[var(--accent-on)] text-xs font-semibold">导入预设</button>
      </header>
      <div className="px-6 pt-4 border-b border-[var(--hair)]">
        <div className="flex items-center gap-1">
          {(["agents", "models", "tools"] as const).map((k) => {
            const label = k === "agents" ? "Agent 团" : k === "models" ? "模型 / CLI" : "工具集";
            return (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`px-4 py-2.5 text-sm border-b-2 -mb-px ${tab === k ? "border-[var(--accent)] text-[var(--heading)]" : "border-transparent text-[var(--meta)] hover:text-[var(--heading)]"}`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
      <main className="p-6">
        {tab === "agents" && <AgentsTable />}
        {tab === "models" && <ModelsView />}
        {tab === "tools" && <ToolsView />}
      </main>
    </div>
  );
}

function AgentsTable() {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[2fr_1.5fr_1fr_1.5fr_100px_80px] gap-3 px-3 py-2 text-[10px] uppercase tracking-wider text-[var(--faint)]">
        <span>名称</span>
        <span>职责</span>
        <span>CLI</span>
        <span>模型</span>
        <span>状态</span>
        <span></span>
      </div>
      {AGENTS.map((a) => {
        const tone = a.status === "ready" ? "var(--accent)" : a.status === "running" ? "var(--amber)" : "var(--pink)";
        const label = a.status === "ready" ? "就绪" : a.status === "running" ? "运行中" : "待审查";
        return (
          <div key={a.id} className="grid grid-cols-[2fr_1.5fr_1fr_1.5fr_100px_80px] gap-3 px-3 py-2.5 rounded bg-[var(--bg-2)] items-center text-sm">
            <div className="font-semibold text-[var(--heading)]">{a.name}</div>
            <div className="text-[var(--meta)]">{a.role}</div>
            <div className="text-[var(--body)]" style={{ fontFamily: "var(--font-mono)" }}>{a.cli}</div>
            <div className="text-[var(--body)]" style={{ fontFamily: "var(--font-mono)" }}>{a.model}</div>
            <div>
              <span className="inline-flex items-center gap-1 text-[10px]" style={{ color: tone }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: tone }} />
                {label}
              </span>
            </div>
            <div className="text-right">
              <button className="text-xs text-[var(--accent)] hover:underline">配置</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ModelsView() {
  return (
    <div className="grid grid-cols-2 gap-3">
      {[
        { name: "claude-opus-4-6", cli: "claude", price: "in $0.015 / 1K · out $0.075 / 1K", health: "ok" },
        { name: "claude-sonnet-4-6", cli: "claude", price: "in $0.003 / 1K · out $0.015 / 1K", health: "ok" },
        { name: "claude-haiku-4-5", cli: "claude", price: "in $0.0008 / 1K · out $0.004 / 1K", health: "ok" },
        { name: "gpt-5-thinking", cli: "codex", price: "in $0.005 / 1K · out $0.025 / 1K", health: "starting" },
      ].map((m) => (
        <div key={m.name} className="rounded bg-[var(--bg-2)] p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="font-semibold text-[var(--heading)]" style={{ fontFamily: "var(--font-mono)" }}>{m.name}</div>
            <span className="text-[10px] flex items-center gap-1" style={{ color: m.health === "ok" ? "var(--accent)" : "var(--amber)" }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: m.health === "ok" ? "var(--accent)" : "var(--amber)" }} />
              {m.health === "ok" ? "在线" : "启动中"}
            </span>
          </div>
          <div className="text-xs text-[var(--meta)]" style={{ fontFamily: "var(--font-mono)" }}>{m.cli} · {m.price}</div>
        </div>
      ))}
    </div>
  );
}

function ToolsView() {
  const tools = [
    { name: "web.search", desc: "网络搜索", attached: 6 },
    { name: "kb.search", desc: "知识库 FTS 检索", attached: 8 },
    { name: "file.read", desc: "读 vault 文件", attached: 12 },
    { name: "image.gen", desc: "生成插图", attached: 1 },
    { name: "wechat.draft", desc: "推送微信草稿", attached: 1 },
  ];
  return (
    <div className="space-y-2">
      {tools.map((t) => (
        <div key={t.name} className="flex items-center gap-3 px-3 py-2.5 rounded bg-[var(--bg-2)]">
          <code className="text-sm text-[var(--accent)]" style={{ fontFamily: "var(--font-mono)" }}>{t.name}</code>
          <span className="text-sm text-[var(--body)] flex-1">{t.desc}</span>
          <span className="text-xs text-[var(--meta)]">绑定 {t.attached} 个 agent</span>
          <button className="text-xs text-[var(--meta)] hover:text-[var(--heading)]">详情</button>
        </div>
      ))}
    </div>
  );
}

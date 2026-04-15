import { useEffect, useState } from "react";
import { AgentsPanel } from "../components/config/AgentsPanel.js";
import { TopicExpertPanel } from "../components/config/TopicExpertPanel.js";
import { useCliHealth } from "../hooks/useCliHealth";
import { getAgentConfigs, type AgentConfigEntry } from "../api/writer-client";

type TabKey = "agents" | "models" | "tools" | "topic-experts";

const TABS: { key: TabKey; label: string }[] = [
  { key: "agents", label: "Agent 团" },
  { key: "models", label: "模型 / CLI" },
  { key: "tools", label: "工具集" },
  { key: "topic-experts", label: "选题专家" },
];

export function ConfigWorkbench() {
  const [active, setActive] = useState<TabKey>("agents");
  return (
    <div
      data-testid="page-config-workbench"
      className="rounded border border-[var(--hair)] bg-[var(--bg-1)] overflow-hidden"
    >
      <header className="flex items-center justify-between px-6 h-12 border-b border-[var(--hair)]">
        <h1 className="text-lg font-semibold text-[var(--heading)]">配置</h1>
      </header>
      <div role="tablist" className="flex items-center gap-1 px-6 pt-3 border-b border-[var(--hair)]">
        {TABS.map((t) => {
          const selected = active === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActive(t.key)}
              className={`px-4 py-2.5 text-sm border-b-2 -mb-px ${
                selected ? "border-[var(--accent)] text-[var(--heading)]" : "border-transparent text-[var(--meta)] hover:text-[var(--heading)]"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <section className="p-6">
        {active === "agents" && <AgentsPanel />}
        {active === "models" && <ModelsView />}
        {active === "tools" && <ToolsView />}
        {active === "topic-experts" && <TopicExpertPanel />}
      </section>
    </div>
  );
}

function ModelsView() {
  const { data: health } = useCliHealth();
  const [agents, setAgents] = useState<Record<string, AgentConfigEntry>>({});
  useEffect(() => {
    getAgentConfigs().then((r) => setAgents(r.agents)).catch(() => {});
  }, []);
  const models = new Set<string>();
  Object.values(agents).forEach((a) => { if (a.model) models.add(`${a.cli ?? "claude"} · ${a.model}`); });
  const list = Array.from(models);
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="rounded bg-[var(--bg-2)] p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="font-semibold text-[var(--heading)]" style={{ fontFamily: "var(--font-mono)" }}>claude</div>
          <HealthChip status={health?.claude?.status} />
        </div>
        <div className="text-xs text-[var(--meta)]" style={{ fontFamily: "var(--font-mono)" }}>{health?.claude?.version ?? "—"}</div>
      </div>
      <div className="rounded bg-[var(--bg-2)] p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="font-semibold text-[var(--heading)]" style={{ fontFamily: "var(--font-mono)" }}>codex</div>
          <HealthChip status={health?.codex?.status} />
        </div>
        <div className="text-xs text-[var(--meta)]" style={{ fontFamily: "var(--font-mono)" }}>{health?.codex?.version ?? "—"}</div>
      </div>
      <div className="col-span-2 rounded bg-[var(--bg-2)] p-4">
        <div className="text-xs text-[var(--meta)] font-semibold mb-3">已启用模型 ({list.length})</div>
        {list.length === 0 ? (
          <div className="text-xs text-[var(--faint)]">加载中…</div>
        ) : (
          <ul className="space-y-1.5 text-sm text-[var(--body)]">
            {list.map((m) => (
              <li key={m} style={{ fontFamily: "var(--font-mono)" }}>{m}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function HealthChip({ status }: { status?: string }) {
  const ok = status === "online";
  const color = ok ? "var(--accent)" : "var(--red)";
  return (
    <span className="inline-flex items-center gap-1 text-[10px]" style={{ color }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
      {ok ? "在线" : status ?? "离线"}
    </span>
  );
}

function ToolsView() {
  const tools = [
    { name: "web.search", desc: "网络搜索", attached: "研究员 / 时代派专家" },
    { name: "kb.search", desc: "知识库 FTS 检索", attached: "全部 Writer agent" },
    { name: "file.read", desc: "读取 vault 文件", attached: "全部 agent" },
    { name: "image.fetch", desc: "抓取图片 / 截图", attached: "Overview Analyst" },
    { name: "wechat.draft", desc: "推送微信公众号草稿", attached: "Publisher" },
  ];
  return (
    <div className="space-y-2">
      {tools.map((t) => (
        <div key={t.name} className="flex items-center gap-3 px-3 py-2.5 rounded bg-[var(--bg-2)]">
          <code className="text-sm text-[var(--accent)]" style={{ fontFamily: "var(--font-mono)" }}>{t.name}</code>
          <span className="text-sm text-[var(--body)] flex-1">{t.desc}</span>
          <span className="text-xs text-[var(--meta)]">{t.attached}</span>
        </div>
      ))}
    </div>
  );
}

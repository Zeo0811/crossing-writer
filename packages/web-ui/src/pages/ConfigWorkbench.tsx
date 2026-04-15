import { useState } from "react";
import { AgentsPanel } from "../components/config/AgentsPanel.js";
import { StylePanelList } from "../components/config/StylePanelList.js";
import { TopicExpertPanel } from "../components/config/TopicExpertPanel.js";

type TabKey = "main" | "distill" | "topic-experts";

const TABS: { key: TabKey; label: string }[] = [
  { key: "main", label: "主流程 Agent" },
  { key: "distill", label: "风格蒸馏" },
  { key: "topic-experts", label: "选题专家团" },
];

export function ConfigWorkbench() {
  const [active, setActive] = useState<TabKey>("main");

  return (
    <div
      data-testid="page-config-workbench"
      className="rounded border border-[var(--hair)] bg-[var(--bg-1)] overflow-hidden"
    >
      <header className="flex items-center justify-between px-6 h-12 border-b border-[var(--hair)]">
        <h1 className="text-base font-semibold text-[var(--heading)]">配置</h1>
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
                selected
                  ? "border-[var(--accent)] text-[var(--heading)]"
                  : "border-transparent text-[var(--meta)] hover:text-[var(--heading)]"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <section className="p-6">
        {active === "main" && <AgentsPanel />}
        {active === "distill" && <StylePanelList />}
        {active === "topic-experts" && <TopicExpertPanel />}
      </section>
    </div>
  );
}

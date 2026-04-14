import { useState } from "react";
import { Link } from "react-router-dom";
import { AgentsPanel } from "../components/config/AgentsPanel.js";
import { StylePanelList } from "../components/config/StylePanelList.js";
import { TopicExpertPanel } from "../components/config/TopicExpertPanel.js";
import { TopNav } from "../components/layout/TopNav";

type TabKey = "main" | "distill" | "topic-experts";

const TABS: { key: TabKey; label: string }[] = [
  { key: "main", label: "📝 主流程" },
  { key: "distill", label: "🎨 蒸馏" },
  { key: "topic-experts", label: "🧑‍🎓 选题专家团" },
];

export function ConfigWorkbench() {
  const [active, setActive] = useState<TabKey>("main");

  return (
    <div
      data-testid="page-config-workbench"
      className="min-h-screen bg-bg-0 text-body"
    >
      <div className="px-8 pt-6">
        <TopNav breadcrumb={["config"]} />
      </div>
      <header
        className="flex items-center justify-between px-8 py-4 border-b border-hair bg-bg-1 mt-4"
      >
        <h1 className="text-xl font-semibold m-0 text-accent">
          配置工作台
        </h1>
        <Link
          to="/"
          className="px-3 py-1 rounded-[2px] border text-sm border-hair text-body no-underline hover:text-accent hover:border-accent"
        >
          ← 返回项目列表
        </Link>
      </header>

      <div role="tablist" className="flex gap-2 px-8 pt-6 border-b border-hair">
        {TABS.map((t) => {
          const selected = active === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActive(t.key)}
              className={`px-4 py-2 text-sm rounded-t cursor-pointer bg-transparent ${selected ? "text-accent font-semibold border-b-2 border-accent" : "text-body border-b-2 border-transparent hover:text-accent"}`}
              style={{ borderTop: "0", borderLeft: "0", borderRight: "0" }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <section className="p-8">
        {active === "main" && <AgentsPanel />}
        {active === "distill" && <StylePanelList />}
        {active === "topic-experts" && <TopicExpertPanel />}
      </section>
    </div>
  );
}

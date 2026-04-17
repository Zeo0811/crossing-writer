import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui";
import { BaseTabPanel } from "../components/config/BaseTabPanel.js";
import { StatusTabPanel } from "../components/config/StatusTabPanel.js";

type TabKey = "base" | "status";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "base", label: "基础" },
  { key: "status", label: "状态" },
];

export function ConfigWorkbench() {
  const [active, setActive] = useState<TabKey>("base");
  return (
    <div
      data-testid="page-config-workbench"
      className="rounded border border-[var(--hair)] bg-[var(--bg-1)] overflow-hidden"
    >
      <header className="flex items-center justify-between px-6 h-12 border-b border-[var(--hair)]">
        <h1 className="text-lg font-semibold text-[var(--heading)]">配置</h1>
      </header>
      <Tabs value={active} onValueChange={(v) => setActive(v as TabKey)}>
        <div className="px-6 pt-3">
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.key} value={t.key}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="base" className="p-6">
          <BaseTabPanel />
        </TabsContent>
        <TabsContent value="status" className="p-6">
          <StatusTabPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

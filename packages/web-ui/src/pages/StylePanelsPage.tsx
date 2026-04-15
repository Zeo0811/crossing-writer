import { useEffect, useState } from "react";
import { getAccounts, listStylePanels, type AccountRow, type StylePanelEntry, type DistillBody } from "../api/style-panels-client.js";
import { StylePanelList } from "../components/style-panels/StylePanelList.js";
import { AccountCandidateList } from "../components/style-panels/AccountCandidateList.js";
import { DistillForm } from "../components/style-panels/DistillForm.js";
import { ProgressView } from "../components/style-panels/ProgressView.js";

type Mode = { kind: "list" } | { kind: "form"; account: string } | { kind: "progress"; account: string; body: DistillBody };

export function StylePanelsPage() {
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [panels, setPanels] = useState<StylePanelEntry[]>([]);
  const [mode, setMode] = useState<Mode>({ kind: "list" });

  async function reload() {
    const [a, p] = await Promise.all([getAccounts(), listStylePanels()]);
    setAccounts(a);
    setPanels(p);
  }
  useEffect(() => { void reload(); }, []);

  const distilledIds = new Set(panels.map((p) => p.id));
  const pendingCount = accounts.filter((a) => !distilledIds.has(a.account)).length;

  return (
    <div data-testid="page-style-panels" className="rounded border border-[var(--hair)] bg-[var(--bg-1)] overflow-hidden">
      <header className="flex items-center justify-between px-6 h-12 border-b border-[var(--hair)]">
        <h1 className="text-base font-semibold text-[var(--heading)]">风格库</h1>
        {mode.kind === "list" && (
          <div className="text-xs text-[var(--meta)]">已蒸馏 {panels.length} · 待蒸馏 {pendingCount}</div>
        )}
      </header>
      <main className="p-6">
        {mode.kind === "form" ? (
          <div className="rounded bg-[var(--bg-2)] p-5">
            <DistillForm
              account={mode.account}
              totalInRange={accounts.find((a) => a.account === mode.account)?.count ?? 0}
              onCancel={() => setMode({ kind: "list" })}
              onSubmit={(body) => setMode({ kind: "progress", account: mode.account, body })}
            />
          </div>
        ) : mode.kind === "progress" ? (
          <div className="rounded bg-[var(--bg-2)] p-5">
            <ProgressView
              account={mode.account}
              body={mode.body}
              onDone={async () => { await reload(); setMode({ kind: "list" }); }}
            />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-5">
            <section className="rounded bg-[var(--bg-2)] p-4">
              <h2 className="text-sm font-semibold mb-3 text-[var(--heading)]">已蒸馏的面板（{panels.length}）</h2>
              <StylePanelList panels={panels} onRedistill={(id) => setMode({ kind: "form", account: id })} />
            </section>
            <section className="rounded bg-[var(--bg-2)] p-4">
              <h2 className="text-sm font-semibold mb-3 text-[var(--heading)]">待蒸馏账号（{pendingCount}）</h2>
              <AccountCandidateList accounts={accounts} distilledIds={distilledIds} onDistill={(a) => setMode({ kind: "form", account: a })} />
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
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

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-5">
      <header className="flex items-center justify-between border-b pb-3">
        <h1 className="text-xl font-semibold">风格面板</h1>
        <Link to="/" className="text-sm text-gray-500 hover:text-black">← 返回项目列表</Link>
      </header>

      {mode.kind === "form" ? (
        <DistillForm
          account={mode.account}
          totalInRange={accounts.find((a) => a.account === mode.account)?.count ?? 0}
          onCancel={() => setMode({ kind: "list" })}
          onSubmit={(body) => setMode({ kind: "progress", account: mode.account, body })}
        />
      ) : mode.kind === "progress" ? (
        <ProgressView
          account={mode.account}
          body={mode.body}
          onDone={async () => { await reload(); setMode({ kind: "list" }); }}
        />
      ) : (
        <>
          <section>
            <h2 className="text-base font-semibold mb-2">已蒸馏的面板（{panels.length}）</h2>
            <StylePanelList panels={panels} onRedistill={(id) => setMode({ kind: "form", account: id })} />
          </section>
          <section>
            <h2 className="text-base font-semibold mb-2">待蒸馏（refs.sqlite 内账号 {accounts.filter((a) => !distilledIds.has(a.account)).length}）</h2>
            <AccountCandidateList accounts={accounts} distilledIds={distilledIds} onDistill={(a) => setMode({ kind: "form", account: a })} />
          </section>
        </>
      )}
    </div>
  );
}

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

  if (mode.kind === "form") {
    const row = accounts.find((a) => a.account === mode.account);
    return (
      <DistillForm
        account={mode.account}
        totalInRange={row?.count ?? 0}
        onCancel={() => setMode({ kind: "list" })}
        onSubmit={(body) => setMode({ kind: "progress", account: mode.account, body })}
      />
    );
  }
  if (mode.kind === "progress") {
    return (
      <ProgressView
        account={mode.account}
        body={mode.body}
        onDone={async () => { await reload(); setMode({ kind: "list" }); }}
      />
    );
  }
  return (
    <div className="style-panels-page">
      <h2>已蒸馏的面板</h2>
      <StylePanelList panels={panels} onRedistill={(id) => setMode({ kind: "form", account: id })} />
      <h2>待蒸馏</h2>
      <AccountCandidateList accounts={accounts} distilledIds={distilledIds} onDistill={(a) => setMode({ kind: "form", account: a })} />
    </div>
  );
}

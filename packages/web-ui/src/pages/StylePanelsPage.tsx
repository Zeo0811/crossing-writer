import { useEffect, useState } from "react";
import { getAccounts, listStylePanels, type AccountRow, type StylePanelEntry, type DistillBody } from "../api/style-panels-client.js";
import { DistillForm } from "../components/style-panels/DistillForm.js";
import { ProgressView } from "../components/style-panels/ProgressView.js";

type Tab = "distilled" | "pending";
type Mode = { kind: "list" } | { kind: "form"; account: string } | { kind: "progress"; account: string; body: DistillBody };

function timeAgo(iso?: string): string {
  if (!iso) return "—";
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60000);
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

export function StylePanelsPage() {
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [panels, setPanels] = useState<StylePanelEntry[]>([]);
  const [tab, setTab] = useState<Tab>("distilled");
  const [active, setActive] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: "list" });

  async function reload() {
    const [a, p] = await Promise.all([getAccounts(), listStylePanels()]);
    setAccounts(a);
    setPanels(p);
    if (!active && p.length > 0) setActive(p[0]!.id);
  }
  useEffect(() => { void reload(); }, []);

  const distilledIds = new Set(panels.map((p) => p.id));
  const pendingAccounts = accounts.filter((a) => !distilledIds.has(a.account));
  const activePanel = panels.find((p) => p.id === active);

  return (
    <div data-testid="page-style-panels" className="rounded border border-[var(--hair)] bg-[var(--bg-1)] overflow-hidden">
      <header className="flex items-center justify-between px-6 h-12 border-b border-[var(--hair)]">
        <h1 className="text-lg font-semibold text-[var(--heading)]">风格库</h1>
        {mode.kind === "list" && (
          <div className="text-xs text-[var(--meta)]">已蒸馏 {panels.length} · 待蒸馏 {pendingAccounts.length}</div>
        )}
      </header>

      {mode.kind === "form" ? (
        <div className="p-6">
          <div className="rounded bg-[var(--bg-2)] p-5">
            <DistillForm
              account={mode.account}
              totalInRange={accounts.find((a) => a.account === mode.account)?.count ?? 0}
              onCancel={() => setMode({ kind: "list" })}
              onSubmit={(body) => setMode({ kind: "progress", account: mode.account, body })}
            />
          </div>
        </div>
      ) : mode.kind === "progress" ? (
        <div className="p-6">
          <div className="rounded bg-[var(--bg-2)] p-5">
            <ProgressView
              account={mode.account}
              body={mode.body}
              onDone={async () => { await reload(); setMode({ kind: "list" }); }}
            />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-[280px_1fr] min-h-[540px]">
          <aside className="border-r border-[var(--hair)] flex flex-col">
            <div className="flex items-center gap-1 p-3 border-b border-[var(--hair)]">
              <TabBtn active={tab === "distilled"} onClick={() => setTab("distilled")}>
                已蒸馏 <span className="ml-1 text-[var(--faint)] text-xs">{panels.length}</span>
              </TabBtn>
              <TabBtn active={tab === "pending"} onClick={() => setTab("pending")}>
                待蒸馏 <span className="ml-1 text-[var(--faint)] text-xs">{pendingAccounts.length}</span>
              </TabBtn>
            </div>
            <div className="flex-1 overflow-auto p-2 space-y-1">
              {tab === "distilled" &&
                panels.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setActive(p.id)}
                    className={`w-full text-left p-2.5 rounded text-xs ${active === p.id ? "bg-[var(--accent-fill)] text-[var(--heading)]" : "hover:bg-[var(--bg-2)] text-[var(--body)]"}`}
                  >
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="font-semibold truncate">{p.id}</span>
                    </div>
                    <div className="text-[10px] text-[var(--meta)]">{timeAgo(p.last_updated_at)}</div>
                  </button>
                ))}
              {tab === "pending" &&
                pendingAccounts.map((a) => (
                  <div key={a.account} className="p-2.5 rounded hover:bg-[var(--bg-2)] flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-[var(--heading)] truncate">{a.account}</div>
                      <div className="text-[10px] text-[var(--meta)]">{a.count} 篇</div>
                    </div>
                    <button
                      onClick={() => setMode({ kind: "form", account: a.account })}
                      className="px-2 py-1 text-[10px] rounded border border-[var(--accent-soft)] text-[var(--accent)] hover:bg-[var(--accent-fill)]"
                    >
                      蒸馏
                    </button>
                  </div>
                ))}
              {tab === "distilled" && panels.length === 0 && <div className="p-4 text-xs text-[var(--faint)]">尚无已蒸馏面板</div>}
              {tab === "pending" && pendingAccounts.length === 0 && <div className="p-4 text-xs text-[var(--faint)]">全部已蒸馏</div>}
            </div>
          </aside>

          <main className="p-6">
            {activePanel ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <h2 className="text-lg text-[var(--heading)] font-semibold truncate">{activePanel.id}</h2>
                  <span className="text-xs px-2 py-0.5 rounded-sm bg-[var(--bg-2)] text-[var(--meta)]">上次更新 {timeAgo(activePanel.last_updated_at)}</span>
                </div>
                <div className="rounded bg-[var(--bg-2)] p-4">
                  <div className="text-xs text-[var(--meta)] mb-2 font-semibold">文件路径</div>
                  <code className="block text-xs text-[var(--body)] break-all" style={{ fontFamily: "var(--font-mono)" }}>{activePanel.path}</code>
                </div>
                <div className="rounded bg-[var(--bg-2)] p-4">
                  <div className="text-xs text-[var(--meta)] mb-2 font-semibold">说明</div>
                  <p className="text-sm text-[var(--body)]">风格面板内容存于本地 vault 文件，打开该 markdown 可查看全文（高频用词 / 示例段落 / 结构提示 / 声线）。</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setMode({ kind: "form", account: activePanel.id })}
                    className="px-4 py-2 rounded border border-[var(--accent-soft)] bg-[var(--accent)] text-[var(--accent-on)] text-sm font-semibold"
                  >
                    重新蒸馏
                  </button>
                </div>
              </div>
            ) : (
              <div className="py-12 text-center text-[var(--meta)]">挑一个账号查看详情</div>
            )}
          </main>
        </div>
      )}
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 px-3 py-1.5 rounded text-xs ${active ? "bg-[var(--accent-fill)] text-[var(--accent)]" : "text-[var(--meta)] hover:text-[var(--heading)]"}`}
    >
      {children}
    </button>
  );
}

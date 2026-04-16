import { useEffect, useState } from "react";
import { getAccounts, type AccountRow, type DistillRole } from "../api/style-panels-client.js";
import { listConfigStylePanels, deleteStylePanel, type StylePanel } from "../api/writer-client";
import { DistillForm } from "../components/style-panels/DistillForm.js";
import { ProgressView } from "../components/style-panels/ProgressView.js";
import { Button } from "../components/ui";
import { useToast } from "../components/ui/ToastProvider";
import { formatBeijingShort } from "../utils/time";

type Tab = "distilled" | "pending";
type Mode =
  | { kind: "list" }
  | { kind: "form"; account: string }
  | { kind: "progress"; account: string; body: { role: DistillRole; limit?: number } };

export function StylePanelsPage() {
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [panels, setPanels] = useState<StylePanel[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("distilled");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: "list" });

  const toast = useToast();

  async function reload() {
    const [a, { panels: p }] = await Promise.all([getAccounts(), listConfigStylePanels()]);
    setAccounts(a);
    setPanels(p);
    if (!activeKey && p.length > 0) setActiveKey(`${p[0]!.account}/${p[0]!.role}/v${p[0]!.version}`);
    setLoading(false);
  }
  useEffect(() => { void reload(); }, []);

  // "已蒸馏" means there's an active non-legacy panel. Accounts that only have
  // legacy flat kb files still count as pending — user can distill a proper
  // role-specific panel for them.
  const properlyDistilled = new Set(panels.filter((p) => !p.is_legacy).map((p) => p.account));
  const pendingAccounts = accounts.filter((a) => !properlyDistilled.has(a.account));
  const activePanel = panels.find((p) => `${p.account}/${p.role}/v${p.version}` === activeKey);

  return (
    <div data-testid="page-style-panels" className="rounded border border-[var(--hair)] bg-[var(--bg-1)] overflow-hidden">
      <header className="flex items-center justify-between px-6 h-12 border-b border-[var(--hair)]">
        <h1 className="text-lg font-semibold text-[var(--heading)]">风格库</h1>
        {mode.kind === "list" && !loading && (
          <div className="text-xs text-[var(--meta)]">已蒸馏 {panels.length} · 待蒸馏 {pendingAccounts.length}</div>
        )}
      </header>
      {loading && (
        <div className="p-12 text-center text-[var(--meta)]">加载中…</div>
      )}

      {loading ? null : mode.kind === "form" ? (
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
                panels.map((p) => {
                  const key = `${p.account}/${p.role}/v${p.version}`;
                  return (
                    <button
                      key={key}
                      onClick={() => setActiveKey(key)}
                      className={`w-full text-left p-2.5 rounded text-xs ${activeKey === key ? "bg-[var(--accent-fill)] text-[var(--heading)]" : "hover:bg-[var(--bg-2)] text-[var(--body)]"}`}
                    >
                      <div className="font-semibold truncate mb-0.5">{p.account}</div>
                      <div className="text-[10px] text-[var(--meta)]">{p.role} · v{p.version}</div>
                    </button>
                  );
                })}
              {tab === "pending" &&
                pendingAccounts.map((a) => (
                  <div key={a.account} className="p-2.5 rounded hover:bg-[var(--bg-2)] flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-[var(--heading)] truncate">{a.account}</div>
                      <div className="text-[10px] text-[var(--meta)]">{a.count} 篇</div>
                    </div>
                    <Button variant="secondary" size="sm" onClick={() => setMode({ kind: "form", account: a.account })}>
                      蒸馏
                    </Button>
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
                  <h2 className="text-lg text-[var(--heading)] font-semibold truncate">{activePanel.account}</h2>
                  <span className="text-xs px-2 py-0.5 rounded-sm bg-[var(--bg-2)] text-[var(--meta)]">{activePanel.role} · v{activePanel.version}</span>
                  <span className="text-xs text-[var(--faint)]">{formatBeijingShort(activePanel.created_at)}</span>
                </div>
                <div className="rounded bg-[var(--bg-2)] p-4">
                  <div className="text-xs text-[var(--meta)] mb-2 font-semibold">说明</div>
                  <p className="text-sm text-[var(--body)]">风格面板内容存于本地 vault 文件，打开该 markdown 可查看全文（高频用词 / 示例段落 / 结构提示 / 声线）。</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="primary" onClick={() => setMode({ kind: "form", account: activePanel.account })}>
                    重新蒸馏
                  </Button>
                  <Button
                    variant="danger"
                    onClick={async () => {
                      if (!window.confirm(`确定删除 ${activePanel.account} / ${activePanel.role} v${activePanel.version}？`)) return;
                      try {
                        await deleteStylePanel(activePanel.account, activePanel.role as any, activePanel.version, true);
                        toast.success("已删除");
                        setActiveKey(null);
                        await reload();
                      } catch (e) {
                        const msg = e instanceof Error ? e.message : String(e);
                        // Panel was already gone on disk — sync the UI and tell the user quietly
                        if (/404/.test(msg) || /not found/i.test(msg)) {
                          toast.info("此面板已不存在，列表已刷新");
                          setActiveKey(null);
                          await reload();
                        } else {
                          toast.error(`删除失败：${msg}`);
                        }
                      }
                    }}
                  >
                    删除
                  </Button>
                </div>
              </div>
            ) : (
              <div className="py-12 text-center text-[var(--meta)]">挑一个面板查看详情</div>
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

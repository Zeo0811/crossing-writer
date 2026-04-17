import { MiniHeatmap } from "./MiniHeatmap";

export interface AccountStat {
  account: string;
  count: number;
  ingested_count: number;
}

export interface AccountSidebarProps {
  accounts: AccountStat[];
  active: string | null;
  cartPerAccount: Map<string, number>;
  onSelect: (account: string) => void;
}

export function AccountSidebar({ accounts, active, cartPerAccount, onSelect }: AccountSidebarProps) {
  return (
    <aside className="w-[220px] shrink-0 bg-[var(--bg-2)] rounded p-3 overflow-auto max-h-[70vh]">
      <div className="text-xs text-[var(--meta)] font-semibold mb-2">账号（{accounts.length}）</div>
      <ul className="space-y-1">
        {accounts.map((a) => {
          const isActive = active === a.account;
          const cart = cartPerAccount.get(a.account) ?? 0;
          return (
            <li key={a.account}>
              <button
                type="button"
                data-testid={`sidebar-item-${a.account}`}
                aria-selected={isActive}
                onClick={() => onSelect(a.account)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left ${
                  isActive ? "bg-[var(--accent-fill)] text-[var(--accent)]" : "text-[var(--body)] hover:bg-[var(--bg-1)]"
                }`}
              >
                <span className="truncate flex-1">{a.account}</span>
                <span className="text-[var(--faint)] shrink-0">{a.count}</span>
                {cart > 0 && (
                  <span
                    data-testid={`sidebar-cart-${a.account}`}
                    className="text-[9px] bg-[var(--accent)] text-[var(--accent-on)] rounded-full px-1.5"
                  >
                    {cart}
                  </span>
                )}
                <MiniHeatmap ingested={a.ingested_count} total={a.count} />
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

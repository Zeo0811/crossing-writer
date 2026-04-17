import { MiniHeatmap } from "./MiniHeatmap";

export interface AccountGridItem {
  account: string;
  count: number;
  ingested_count: number;
}

export interface AccountGridProps {
  accounts: AccountGridItem[];
  cartPerAccount: Map<string, number>;
  onSelect: (account: string) => void;
  onQuickAdd: (account: string) => void;
  quickAddLoading?: string | null;
}

export function AccountGrid({ accounts, cartPerAccount, onSelect, onQuickAdd, quickAddLoading }: AccountGridProps) {
  return (
    <div
      data-testid="account-grid"
      className="grid gap-3"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}
    >
      {accounts.map((a) => {
        const cart = cartPerAccount.get(a.account) ?? 0;
        const unIngested = a.count - a.ingested_count;
        const loading = quickAddLoading === a.account;
        return (
          <div
            key={a.account}
            data-testid={`account-card-${a.account}`}
            className="rounded border border-[var(--hair)] bg-[var(--bg-2)] p-3 hover:border-[var(--accent-soft)] transition-colors group"
          >
            <button
              type="button"
              onClick={() => onSelect(a.account)}
              className="w-full text-left block"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-semibold text-[var(--heading)] truncate flex-1">{a.account}</span>
                {cart > 0 && (
                  <span
                    data-testid={`card-cart-${a.account}`}
                    className="text-[9px] bg-[var(--accent)] text-[var(--accent-on)] rounded-full px-1.5 py-0.5 shrink-0"
                  >
                    {cart}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mb-2">
                <MiniHeatmap ingested={a.ingested_count} total={a.count} />
                <span className="text-[10px] text-[var(--faint)] shrink-0 font-mono">
                  {a.ingested_count}/{a.count}
                </span>
              </div>
            </button>
            <button
              type="button"
              data-testid={`card-quickadd-${a.account}`}
              disabled={unIngested === 0 || loading}
              onClick={(e) => { e.stopPropagation(); onQuickAdd(a.account); }}
              className="w-full mt-1 px-2 py-1 text-[10px] rounded border border-[var(--hair)] text-[var(--meta)] hover:text-[var(--accent)] hover:border-[var(--accent-soft)] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? "加载中…" : unIngested === 0 ? "全部已入库" : `+ 勾未入库（最多 50）`}
            </button>
          </div>
        );
      })}
    </div>
  );
}

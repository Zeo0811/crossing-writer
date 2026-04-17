import { MiniHeatmap } from "./MiniHeatmap";

export interface AccountGridItem {
  account: string;
  count: number;
  ingested_count: number;
  earliest_published_at?: string;
  latest_published_at?: string;
}

export interface AccountGridProps {
  accounts: AccountGridItem[];
  cartPerAccount: Map<string, number>;
  onSelect: (account: string) => void;
}

export function AccountGrid({ accounts, cartPerAccount, onSelect }: AccountGridProps) {
  return (
    <div
      data-testid="account-grid"
      className="grid gap-3"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}
    >
      {accounts.map((a) => {
        const cart = cartPerAccount.get(a.account) ?? 0;
        const unIngested = a.count - a.ingested_count;
        const latest = a.latest_published_at ? a.latest_published_at.slice(0, 10) : null;
        return (
          <button
            key={a.account}
            type="button"
            data-testid={`account-card-${a.account}`}
            onClick={() => onSelect(a.account)}
            className="text-left rounded border border-[var(--hair)] bg-[var(--bg-2)] p-3 hover:border-[var(--accent-soft)] transition-colors"
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-semibold text-[var(--heading)] truncate flex-1">{a.account}</span>
              {cart > 0 && (
                <span
                  data-testid={`card-cart-${a.account}`}
                  className="text-[9px] bg-[var(--accent)] text-[var(--accent-on)] rounded-full px-1.5 py-0.5 shrink-0"
                >
                  已选 {cart}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mb-2">
              <MiniHeatmap ingested={a.ingested_count} total={a.count} />
              <span className="text-[10px] text-[var(--faint)] shrink-0 font-mono">
                {a.ingested_count}/{a.count}
              </span>
            </div>
            <div className="flex items-center justify-between text-[10px] text-[var(--meta)]">
              <span>
                未入库 <span className={unIngested > 0 ? "text-[var(--body)] font-semibold" : "text-[var(--faint)]"}>{unIngested}</span>
              </span>
              {latest && <span className="text-[var(--faint)] font-mono">最近 {latest}</span>}
            </div>
          </button>
        );
      })}
    </div>
  );
}

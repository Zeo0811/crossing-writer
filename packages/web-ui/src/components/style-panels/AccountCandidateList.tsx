import type { AccountRow } from "../../api/style-panels-client.js";

export interface AccountCandidateListProps {
  accounts: AccountRow[];
  distilledIds: Set<string>;
  onDistill: (account: string) => void;
}

export function AccountCandidateList({ accounts, distilledIds, onDistill }: AccountCandidateListProps) {
  const candidates = accounts.filter((a) => !distilledIds.has(a.account));
  if (candidates.length === 0) return <div className="empty">所有账号都已蒸馏</div>;
  return (
    <ul className="account-candidate-list">
      {candidates.map((a) => (
        <li key={a.account}>
          <span className="account">{a.account}</span>
          <span className="count">{a.count} 篇</span>
          <span className="range">{a.earliest_published_at.slice(0, 7)} ~ {a.latest_published_at.slice(0, 7)}</span>
          <button type="button" onClick={() => onDistill(a.account)}>蒸馏</button>
        </li>
      ))}
    </ul>
  );
}

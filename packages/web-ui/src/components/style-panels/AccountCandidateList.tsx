import type { AccountRow } from "../../api/style-panels-client.js";

export interface AccountCandidateListProps {
  accounts: AccountRow[];
  distilledIds: Set<string>;
  onDistill: (account: string) => void;
}

export function AccountCandidateList({ accounts, distilledIds, onDistill }: AccountCandidateListProps) {
  const candidates = accounts.filter((a) => !distilledIds.has(a.account));
  if (candidates.length === 0) return <div className="text-sm text-gray-500">所有账号都已蒸馏</div>;
  return (
    <ul className="divide-y border rounded max-h-[60vh] overflow-auto">
      {candidates.map((a) => (
        <li key={a.account} className="flex items-center gap-3 px-3 py-2 text-sm">
          <span className="font-medium flex-1">{a.account}</span>
          <span className="text-xs text-gray-600 w-20 text-right">{a.count} 篇</span>
          <span className="text-xs text-gray-500 w-40 text-right">{a.earliest_published_at.slice(0, 7)} ~ {a.latest_published_at.slice(0, 7)}</span>
          <button type="button" onClick={() => onDistill(a.account)} className="px-2 py-1 border rounded text-xs hover:bg-gray-50">
            蒸馏
          </button>
        </li>
      ))}
    </ul>
  );
}

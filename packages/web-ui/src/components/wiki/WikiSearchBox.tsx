import { useEffect, useState } from "react";

export interface WikiSearchBoxProps { onSearch: (q: string) => void }

export function WikiSearchBox({ onSearch }: WikiSearchBoxProps) {
  const [q, setQ] = useState("");

  useEffect(() => {
    const t = setTimeout(() => {
      if (q.trim()) onSearch(q.trim());
    }, 300);
    return () => clearTimeout(t);
  }, [q, onSearch]);

  return (
    <input
      type="search"
      placeholder="Search wiki..."
      value={q}
      onChange={(e) => setQ(e.target.value)}
      className="w-full px-2 py-1 border rounded text-sm"
    />
  );
}

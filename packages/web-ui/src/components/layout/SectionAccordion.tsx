import { useState, type ReactNode } from "react";

export type SectionStatus = "completed" | "active" | "pending";

export function SectionAccordion({ children }: { children: ReactNode }) {
  return <div className="space-y-2">{children}</div>;
}

export function Section({
  title, status, children,
}: { title: ReactNode; status: SectionStatus; children: ReactNode }) {
  const [expanded, setExpanded] = useState(status === "active");

  function onToggle() {
    if (status === "pending") return;
    setExpanded((v) => !v);
  }

  const color = status === "completed" ? "text-gray-500"
    : status === "active" ? "text-blue-600 font-semibold"
    : "text-gray-300";

  return (
    <div className="border rounded">
      <button onClick={onToggle}
        className={`w-full text-left px-3 py-2 ${color}`}
        disabled={status === "pending"}>
        {title} <span className="text-xs">[{status}]</span>
      </button>
      {expanded && <div className="p-3 border-t">{children}</div>}
    </div>
  );
}

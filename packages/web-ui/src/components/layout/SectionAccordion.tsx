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

  const color = status === "completed" ? "text-[var(--meta)]"
    : status === "active" ? "text-[var(--accent)] font-semibold"
    : "text-[var(--faint)]";

  return (
    <div className="border rounded">
      <button onClick={onToggle}
        className={`w-full text-left px-3 py-2 ${color}`}
        disabled={status === "pending"}>
        {title}
      </button>
      {expanded && <div className="p-3 border-t">{children}</div>}
    </div>
  );
}

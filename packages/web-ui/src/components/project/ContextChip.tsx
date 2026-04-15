import { useEffect, useState } from "react";
import { ContextModal } from "./ContextModal";

export interface ContextChipProps {
  projectId: string;
}

interface Summary {
  projectId: string;
  builtAt: string;
  tokensEstimated: number;
  truncated: boolean;
}

/**
 * SP-19 floating chip: shows estimated token size of the unified ContextBundle
 * for the current project and opens a debug modal with the full snapshot when
 * clicked. Read-only — purely a transparency surface.
 */
export function ContextChip({ projectId }: ContextChipProps) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${projectId}/context?summary=1`)
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => { if (!cancelled && s) setSummary(s); })
      .catch(() => { /* hide on error */ });
    return () => { cancelled = true; };
  }, [projectId]);

  if (!summary) return null;

  const tokK = (summary.tokensEstimated / 1000).toFixed(1);

  return (
    <>
      <button
        type="button"
        data-testid="context-chip"
        onClick={() => setOpen(true)}
        title={`Built ${summary.builtAt}${summary.truncated ? " (truncated)" : ""}`}
        style={{
          position: "fixed",
          right: 16,
          bottom: 16,
          padding: "6px 12px",
          borderRadius: 9999,
          background: "rgba(15,23,42,0.85)",
          color: "white",
          fontSize: 12,
          border: "1px solid rgba(255,255,255,0.2)",
          cursor: "pointer",
          zIndex: 30,
        }}
      >
        Context 📦 ~{tokK}k tok{summary.truncated ? " ✂︎" : ""}
      </button>
      {open && (
        <ContextModal projectId={projectId} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

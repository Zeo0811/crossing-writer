import { useEffect, useState } from "react";

export interface ContextModalProps {
  projectId: string;
  onClose: () => void;
}

export function ContextModal({ projectId, onClose }: ContextModalProps) {
  const [bundle, setBundle] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${projectId}/context`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then((j) => { if (!cancelled) setBundle(j); })
      .catch((e) => { if (!cancelled) setError(String(e?.message ?? e)); });
    return () => { cancelled = true; };
  }, [projectId]);

  return (
    <div
      data-testid="context-modal"
      role="dialog"
      aria-label="Project Context Bundle"
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
        zIndex: 40, display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "white", borderRadius: 8, padding: 16,
          maxWidth: "80vw", maxHeight: "80vh", overflow: "auto", minWidth: 360,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Project Context Bundle</h2>
          <button type="button" onClick={onClose} aria-label="Close" data-testid="context-modal-close">×</button>
        </div>
        {error && <div style={{ color: "crimson", fontSize: 12 }}>Error: {error}</div>}
        {!error && !bundle && <div style={{ fontSize: 12 }}>Loading…</div>}
        {bundle && (
          <pre data-testid="context-modal-pre" style={{ fontSize: 11, whiteSpace: "pre-wrap", marginTop: 12 }}>
            {JSON.stringify(bundle, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

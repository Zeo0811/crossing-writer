interface Props {
  name: string;
  status: "pending" | "running" | "done" | "failed";
  markdown: string;
  error?: string;
  onRetry?: () => void;
}

export function ExpertStreamCard({ name, status, markdown, error, onRetry }: Props) {
  return (
    <div data-testid={`expert-card-${name}`} className="border rounded p-2 m-1">
      <div className="font-semibold">
        {name} <span data-testid={`expert-status-${name}`}>[{status}]</span>
      </div>
      {status === "failed" ? (
        <div role="alert">
          <span className="text-[var(--red)]">{error}</span>
          {onRetry && (
            <button onClick={onRetry} data-testid={`expert-retry-${name}`}>重试</button>
          )}
        </div>
      ) : (
        <pre data-testid={`expert-md-${name}`} style={{ whiteSpace: "pre-wrap" }}>
          {markdown}
        </pre>
      )}
    </div>
  );
}

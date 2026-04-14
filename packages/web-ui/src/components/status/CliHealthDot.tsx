import { useEffect, useRef, useState } from "react";
import type { CliHealthItem } from "../../api/system-health";
import { CLI_INSTALL_HINTS } from "./cliInstallHints";
import { copyToClipboard } from "./copyToClipboard";

export interface CliHealthDotProps {
  label: "CLAUDE" | "CODEX";
  item: CliHealthItem;
  onCopy?: (text: string) => Promise<void | boolean>;
}

function formatRelative(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const deltaSec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (deltaSec < 5) return "刚刚";
  if (deltaSec < 60) return `${deltaSec} 秒前`;
  const min = Math.floor(deltaSec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  return `${hr} 小时前`;
}

export function CliHealthDot({ label, item, onCopy }: CliHealthDotProps) {
  const [open, setOpen] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  const key = label.toLowerCase() as "claude" | "codex";
  const hint = CLI_INSTALL_HINTS[key];
  const isOnline = item.status === "online";
  const color = isOnline ? "var(--accent)" : "var(--red)";
  const ariaLabel = `${label} ${item.status}`;
  const titleHint = isOnline
    ? (item.version ? `v${item.version}` : "online")
    : (item.error ?? item.status);

  function handleEnter() {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    setOpen(true);
  }
  function handleLeave() {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setOpen(false), 150);
  }

  async function doCopy(text: string, idx: number) {
    try {
      if (onCopy) {
        await onCopy(text);
      } else {
        await copyToClipboard(text);
      }
      setCopiedIndex(idx);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopiedIndex(null), 1500);
    } catch {
      // swallow; UI remains unchanged
    }
  }

  const title = `${label} · ${item.status.toUpperCase()}${item.version ? " v" + item.version : ""}`;
  const statusLine = isOnline
    ? `更新于 ${formatRelative(item.checkedAt)}`
    : (item.error ?? "unknown");

  return (
    <span
      style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 6 }}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      <span
        aria-label={ariaLabel}
        title={titleHint}
        role="status"
        data-pixel-dot=""
        className="pixel-dot"
        style={{
          display: "inline-block",
          width: 10,
          height: 10,
          borderRadius: 0,
          backgroundColor: color,
          imageRendering: "pixelated",
          clipPath: "polygon(25% 0, 75% 0, 100% 25%, 100% 75%, 75% 100%, 25% 100%, 0 75%, 0 25%)",
        }}
      />
      <span style={{ fontSize: 11, color: "var(--meta)", letterSpacing: 0.5 }}>{label}</span>
      {open && (
        <div
          role="dialog"
          aria-label={`${label} CLI status`}
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            marginTop: 6,
            width: 280,
            background: "var(--bg-1)",
            color: "var(--body)",
            border: "1px solid var(--hair)",
            borderRadius: 6,
            boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
            padding: 12,
            zIndex: 50,
            fontSize: 12,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4, color: "var(--heading)" }}>{title}</div>
          <div style={{ color: "var(--meta)", marginBottom: 8 }}>{statusLine}</div>
          <div style={{ borderTop: "1px solid var(--hair)", margin: "8px 0" }} />
          {([
            { label: "安装", cmd: hint.install },
            { label: "登录", cmd: hint.login },
          ] as const).map((row, idx) => (
            <div
              key={row.label}
              style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}
            >
              <div style={{ width: 32, color: "var(--faint)" }}>{row.label}</div>
              <code
                style={{
                  flex: 1,
                  background: "var(--bg-2)",
                  color: "var(--body)",
                  padding: "2px 6px",
                  borderRadius: 4,
                  fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
                  fontSize: 11,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {row.cmd}
              </code>
              <button
                type="button"
                aria-label={`Copy ${row.label}`}
                onClick={() => void doCopy(row.cmd, idx)}
                style={{
                  border: "1px solid var(--hair)",
                  background: "var(--bg-2)",
                  color: "var(--body)",
                  borderRadius: 4,
                  fontSize: 11,
                  padding: "2px 6px",
                  cursor: "pointer",
                }}
              >
                {copiedIndex === idx ? "已复制" : "Copy"}
              </button>
            </div>
          ))}
          <div style={{ marginTop: 6, color: "var(--faint)", fontSize: 11 }}>每 30 秒自动检测</div>
        </div>
      )}
    </span>
  );
}

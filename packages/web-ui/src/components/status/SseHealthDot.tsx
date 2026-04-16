import type { ConnectionState } from "../../hooks/useProjectStream";

const colorMap: Record<ConnectionState, string> = {
  connected: "bg-[var(--accent)]",
  reconnecting: "bg-yellow-500",
  disconnected: "bg-[rgba(255,107,107,0.08)]0",
  connecting: "bg-[var(--faint)]",
};

const labelMap: Record<ConnectionState, string> = {
  connected: "已连接",
  reconnecting: "重连中",
  disconnected: "已断开",
  connecting: "连接中",
};

export function SseHealthDot({
  connectionState,
  lastEventTs,
}: {
  connectionState: ConnectionState;
  lastEventTs: number | null;
}) {
  const ageSec = lastEventTs ? Math.floor((Date.now() - lastEventTs) / 1000) : null;
  const title = ageSec != null
    ? `SSE ${labelMap[connectionState]} · 最近事件 ${ageSec}s 前`
    : `SSE ${labelMap[connectionState]}`;
  return (
    <span
      data-testid="sse-dot"
      title={title}
      className={`inline-block w-2 h-2 rounded-full ${colorMap[connectionState]}`}
    />
  );
}

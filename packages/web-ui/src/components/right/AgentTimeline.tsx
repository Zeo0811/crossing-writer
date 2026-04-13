import { useProjectStream } from "../../hooks/useProjectStream";

const LABELS: Record<string, string> = {
  state_changed: "状态",
  "agent.started": "Agent 开始",
  "agent.completed": "Agent 完成",
  "agent.failed": "Agent 失败",
  "expert.round1_started": "专家 R1 开始",
  "expert.round1_completed": "专家 R1 完成",
  "expert.round2_started": "专家 R2 开始",
  "expert.round2_completed": "专家 R2 完成",
  "coordinator.synthesizing": "Coordinator 合成",
  "coordinator.candidates_ready": "候选就绪",
  "coordinator.aggregating": "Coordinator 聚合",
  "refs_pack.generated": "Refs pack 已建",
};

function summarize(data: any): string {
  if (data.expert) return `@${data.expert}`;
  if (data.from && data.to) return `${data.from} → ${data.to}`;
  if (data.agent) return `@${data.agent}`;
  return "";
}

export function AgentTimeline({ projectId }: { projectId: string }) {
  const { events } = useProjectStream(projectId);
  return (
    <div
      className="p-4 bg-white rounded border"
      style={{ borderColor: "var(--border)" }}
    >
      <h3 className="font-semibold mb-2">实时进度</h3>
      <ol className="space-y-1 text-sm max-h-96 overflow-y-auto">
        {events.length === 0 && <li className="text-gray-400">暂无事件</li>}
        {events.map((e, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-gray-400">
              {new Date(e.ts).toLocaleTimeString()}
            </span>
            <span
              className={`font-medium ${e.type === "agent.failed" ? "text-red-600" : ""}`}
              style={{
                color:
                  e.type === "agent.failed" ? undefined : "var(--green-dark)",
              }}
            >
              {LABELS[e.type] ?? e.type}
            </span>
            <span className="text-gray-600">{summarize(e.data)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

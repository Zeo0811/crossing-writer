export interface AgentEntry {
  cli: "claude" | "codex";
  model?: string;
}

export interface AgentsConfig {
  defaultCli: "claude" | "codex";
  fallbackCli: "claude" | "codex";
  agents: Record<string, AgentEntry>;
}

export async function getAgentsConfig(): Promise<AgentsConfig> {
  const res = await fetch("/api/config/agents");
  if (!res.ok) throw new Error(`GET config failed: ${res.status}`);
  return res.json();
}

export async function patchAgentsConfig(patch: Partial<AgentsConfig>): Promise<void> {
  const res = await fetch("/api/config/agents", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `PATCH config failed: ${res.status}`);
  }
}

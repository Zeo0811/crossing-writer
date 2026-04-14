export type CliStatus = "online" | "offline" | "error";

export interface CliHealthItem {
  status: CliStatus;
  version?: string;
  error?: string;
  checkedAt: string;
}

export interface CliHealthResponse {
  claude: CliHealthItem;
  codex: CliHealthItem;
}

export async function fetchCliHealth(): Promise<CliHealthResponse> {
  const res = await fetch("/api/system/cli-health");
  if (!res.ok) {
    throw new Error(`cli-health request failed: ${res.status}`);
  }
  return (await res.json()) as CliHealthResponse;
}

export interface AccountRow {
  account: string;
  count: number;
  earliest_published_at: string;
  latest_published_at: string;
}

export interface StylePanelEntry {
  id: string;
  path: string;
  last_updated_at: string;
}

export interface DistillBody {
  sample_size?: number;
  since?: string;
  until?: string;
  only_step?: "quant" | "structure" | "snippets" | "composer";
  cli_model_per_step?: Partial<Record<"structure" | "snippets" | "composer", { cli: "claude" | "codex"; model?: string }>>;
}

async function fetchOk(input: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${init?.method ?? "GET"} ${input} → ${res.status}: ${text}`);
  }
  return res;
}

export async function getAccounts(): Promise<AccountRow[]> {
  const res = await fetchOk(`/api/kb/accounts`);
  return res.json();
}

export async function listStylePanels(): Promise<StylePanelEntry[]> {
  const res = await fetchOk(`/api/kb/style-panels`);
  return res.json();
}

export async function startDistillStream(
  account: string,
  body: DistillBody,
  onEvent: (ev: { type: string; data: any }) => void,
): Promise<void> {
  const res = await fetch(`/api/kb/style-panels/${encodeURIComponent(account)}/distill`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`distill start failed: ${res.status}: ${text}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const eventMatch = /^event:\s*(.+)$/m.exec(raw);
      const dataMatch = /^data:\s*(.*)$/m.exec(raw);
      if (eventMatch && dataMatch) {
        try { onEvent({ type: eventMatch[1]!.trim(), data: JSON.parse(dataMatch[1]!) }); }
        catch { onEvent({ type: eventMatch[1]!.trim(), data: dataMatch[1]! }); }
      }
    }
  }
}

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

export type DistillRole = "opening" | "practice" | "closing";

export interface RoleDistillBody {
  role: DistillRole;
  limit?: number;
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
  await consumeSse(res, onEvent);
}

/**
 * Role-scoped distillation (new format, single role).
 * Produces <base>/<account>/<role>-v<version>.md with proper role frontmatter.
 */
export async function startRoleDistillStream(
  body: { account: string; role: DistillRole; limit?: number },
  onEvent: (ev: { type: string; data: any }) => void,
): Promise<void> {
  const res = await fetch(`/api/config/style-panels/distill`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  await consumeSse(res, onEvent);
}

/**
 * All-roles distillation — shares the slicer pass across opening/practice/closing,
 * much faster than calling per-role three times.
 */
export async function startAllRolesDistillStream(
  body: { account: string; limit?: number },
  onEvent: (ev: { type: string; data: any }) => void,
): Promise<void> {
  const res = await fetch(`/api/config/style-panels/distill-all`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  await consumeSse(res, onEvent);
}

export interface RunSummary {
  run_id: string;
  account?: string;
  started_at: string;
  status: 'active' | 'finished' | 'failed';
  last_event_type?: string;
}

export async function listActiveDistillRuns(): Promise<RunSummary[]> {
  const res = await fetchOk('/api/config/style-panels/runs?status=active');
  return (await res.json()).runs as RunSummary[];
}

/**
 * Start a v2 full-account distillation. Returns the run_id to subscribe to.
 * Does NOT stream events directly; use streamDistillRun(runId, ...) next.
 */
export async function startAllRolesDistillReturningRunId(
  body: { account: string; limit?: number },
): Promise<{ run_id: string }> {
  const res = await fetchOk('/api/config/style-panels/distill-all-v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

/**
 * Subscribe to a run's SSE stream. Replays history then streams live.
 * Returns an unsubscribe function.
 */
const V2_EVENT_TYPES = [
  'distill.started',
  'sampling.done',
  'labeling.article_done',
  'labeling.all_done',
  'aggregation.done',
  'composer.started',
  'composer.done',
  'distill.finished',
  'distill.failed',
];

export function streamDistillRun(
  runId: string,
  onEvent: (ev: { type: string; data: any }) => void,
): () => void {
  const es = new EventSource(
    `/api/config/style-panels/runs/${encodeURIComponent(runId)}/stream`,
  );
  const handler = (e: MessageEvent, type: string) => {
    try {
      const data = JSON.parse(e.data);
      onEvent({ type, data });
    } catch { /* ignore malformed */ }
  };
  for (const t of V2_EVENT_TYPES) {
    es.addEventListener(t, (e: MessageEvent) => handler(e, t));
  }
  return () => es.close();
}

export async function cleanupLegacyPanels(): Promise<{ removed: string[] }> {
  const res = await fetchOk('/api/config/style-panels/cleanup-legacy', { method: 'POST' });
  return res.json();
}

async function consumeSse(res: Response, onEvent: (ev: { type: string; data: any }) => void) {
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

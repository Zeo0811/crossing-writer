export type WriterAgentKey =
  | "writer.opening" | "writer.practice" | "writer.closing"
  | "practice.stitcher" | "style_critic";

export interface ToolUsageFrontmatter {
  tool: string;
  round: number;
  hits_count?: number;
  query?: string;
  args?: Record<string, string>;
  pinned_by?: string;
  ok?: boolean;
  summary?: string;
  toolName?: string;
  [k: string]: unknown;
}

export interface SectionFrontmatter {
  section: string;
  last_agent: string;
  last_updated_at: string;
  reference_accounts?: string[];
  cli?: string;
  model?: string;
  tools_used?: ToolUsageFrontmatter[];
}

export interface SectionListItem {
  key: string;
  frontmatter: SectionFrontmatter;
  preview: string;
}

export interface ArticleSectionFile {
  key: string;
  frontmatter: SectionFrontmatter;
  body: string;
}

export interface StylePanelEntry {
  id: string;
  path: string;
  last_updated_at: string;
}

export interface StartWriterBody {
  cli_model_per_agent: Partial<Record<WriterAgentKey, { cli: "claude" | "codex"; model?: string }>>;
  reference_accounts_per_agent: Partial<Record<WriterAgentKey, string[]>>;
}

async function throwingFetch(input: string, init?: RequestInit) {
  const res = await fetch(input, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${init?.method ?? "GET"} ${input} → ${res.status}: ${text}`);
  }
  return res;
}

export async function getSections(projectId: string): Promise<{ sections: SectionListItem[] }> {
  const res = await throwingFetch(`/api/projects/${projectId}/writer/sections`);
  return res.json();
}

export async function getSection(projectId: string, key: string): Promise<ArticleSectionFile> {
  const res = await throwingFetch(`/api/projects/${projectId}/writer/sections/${encodeURIComponent(key)}`);
  return res.json();
}

export async function putSection(
  projectId: string,
  key: string,
  bodyOrPayload: string | { body: string; frontmatter?: Record<string, unknown> },
): Promise<void> {
  const payload = typeof bodyOrPayload === "string" ? { body: bodyOrPayload } : bodyOrPayload;
  await throwingFetch(`/api/projects/${projectId}/writer/sections/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export interface UploadImageResult {
  url: string;
  filename: string;
  bytes: number;
  mime: string;
}

export async function uploadImage(projectId: string, file: File): Promise<UploadImageResult> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/images`, {
    method: "POST",
    body: fd,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`uploadImage ${res.status}: ${text}`);
  }
  return res.json() as Promise<UploadImageResult>;
}

export async function startWriter(projectId: string, body: StartWriterBody): Promise<void> {
  await throwingFetch(`/api/projects/${projectId}/writer/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function retryFailed(projectId: string): Promise<void> {
  await throwingFetch(`/api/projects/${projectId}/writer/retry-failed`, { method: "POST" });
}

export async function getFinal(projectId: string): Promise<string> {
  const res = await throwingFetch(`/api/projects/${projectId}/writer/final`);
  return res.text();
}

export async function listStylePanels(): Promise<StylePanelEntry[]> {
  const res = await throwingFetch(`/api/kb/style-panels`);
  return res.json();
}

export interface RewriteSelectionBody {
  selected_text: string;
  user_prompt: string;
}

export interface RewriteSelectionStream {
  onEvent: (cb: (ev: { type: string; error?: string; data?: any }) => void) => void;
  close: () => void;
}

export function rewriteSelection(
  projectId: string,
  sectionKey: string,
  body: RewriteSelectionBody,
): RewriteSelectionStream {
  const controller = new AbortController();
  let callback: ((ev: { type: string; error?: string; data?: any }) => void) | null = null;
  const emit = (ev: { type: string; error?: string; data?: any }) => {
    if (callback) callback(ev);
  };
  (async () => {
    try {
      const res = await fetch(
        `/api/projects/${projectId}/writer/sections/${encodeURIComponent(sectionKey)}/rewrite-selection`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      );
      if (!res.ok || !res.body) {
        emit({ type: "writer.failed", error: `rewrite-selection HTTP ${res.status}` });
        return;
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
          if (eventMatch) {
            const type = eventMatch[1]!.trim();
            let data: any = undefined;
            if (dataMatch) {
              try { data = JSON.parse(dataMatch[1]!); } catch { data = dataMatch[1]!; }
            }
            emit({ type, data, error: data?.error });
          }
        }
      }
    } catch (err: unknown) {
      emit({ type: "writer.failed", error: err instanceof Error ? err.message : String(err) });
    }
  })();
  return {
    onEvent: (cb) => { callback = cb; },
    close: () => controller.abort(),
  };
}

// ============================================================================
// SP-10: Config Workbench APIs
// ============================================================================

export type StyleBindingRole = "opening" | "practice" | "closing";

export interface AgentStyleBinding {
  account: string;
  role: StyleBindingRole;
}

export interface AgentModelConfig {
  cli: "claude" | "codex";
  model?: string;
}

export interface AgentToolsConfig {
  [toolKey: string]: boolean;
}

export interface AgentConfigEntry {
  agentKey: string;
  model: AgentModelConfig;
  promptVersion?: string;
  styleBinding?: AgentStyleBinding;
  tools?: AgentToolsConfig;
}

export type StylePanelRole = "opening" | "practice" | "closing" | "legacy";

export interface StylePanel {
  account: string;
  role: StylePanelRole;
  version: number;
  status: "active" | "deleted";
  created_at: string;
  source_article_count: number;
  absPath: string;
  is_legacy: boolean;
}

export interface ProjectOverride {
  agents: Partial<Record<string, Partial<AgentConfigEntry>>>;
}

export async function getAgentConfigs(): Promise<{ agents: Record<string, AgentConfigEntry> }> {
  const res = await throwingFetch(`/api/config/agents`);
  return res.json();
}

export async function getAgentConfig(agentKey: string): Promise<AgentConfigEntry> {
  const res = await throwingFetch(`/api/config/agents/${encodeURIComponent(agentKey)}`);
  return res.json();
}

export async function setAgentConfig(agentKey: string, cfg: AgentConfigEntry): Promise<void> {
  await throwingFetch(`/api/config/agents/${encodeURIComponent(agentKey)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cfg),
  });
}

export interface ListStylePanelsFilters {
  account?: string;
  role?: StyleBindingRole | "legacy";
  include_deleted?: boolean;
}

export async function listConfigStylePanels(
  filters?: ListStylePanelsFilters,
): Promise<{ panels: StylePanel[] }> {
  let url = `/api/config/style-panels`;
  if (filters) {
    const params = new URLSearchParams();
    if (filters.account) params.set("account", filters.account);
    if (filters.role) params.set("role", filters.role);
    if (filters.include_deleted) params.set("include_deleted", "1");
    const qs = params.toString();
    if (qs) url = `${url}?${qs}`;
  }
  const res = await throwingFetch(url);
  return res.json();
}

export async function deleteStylePanel(
  account: string,
  role: StyleBindingRole | "legacy",
  version: number,
  hard?: boolean,
): Promise<void> {
  let url = `/api/config/style-panels/${encodeURIComponent(account)}/${encodeURIComponent(role)}/${version}`;
  if (hard) url += `?hard=1`;
  await throwingFetch(url, { method: "DELETE" });
}

export interface DistillStylePanelStream {
  onEvent: (cb: (ev: { type: string; error?: string; data?: any }) => void) => void;
  close: () => void;
}

export function distillStylePanel(
  account: string,
  role: StyleBindingRole,
  limit?: number,
): DistillStylePanelStream {
  const controller = new AbortController();
  let callback: ((ev: { type: string; error?: string; data?: any }) => void) | null = null;
  const emit = (ev: { type: string; error?: string; data?: any }) => {
    if (callback) callback(ev);
  };
  (async () => {
    try {
      const body: Record<string, unknown> = { account, role };
      if (limit !== undefined) body.limit = limit;
      const res = await fetch(`/api/config/style-panels/distill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        emit({ type: "distill.failed", error: `distill HTTP ${res.status}` });
        return;
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
          if (eventMatch) {
            const type = eventMatch[1]!.trim();
            let data: any = undefined;
            if (dataMatch) {
              try { data = JSON.parse(dataMatch[1]!); } catch { data = dataMatch[1]!; }
            }
            emit({ type, data, error: data?.error });
          }
        }
      }
    } catch (err: unknown) {
      emit({ type: "distill.failed", error: err instanceof Error ? err.message : String(err) });
    }
  })();
  return {
    onEvent: (cb) => { callback = cb; },
    close: () => controller.abort(),
  };
}

export function distillAllRoles(
  account: string,
  limit?: number,
): DistillStylePanelStream {
  const controller = new AbortController();
  let callback: ((ev: { type: string; error?: string; data?: any }) => void) | null = null;
  const emit = (ev: { type: string; error?: string; data?: any }) => {
    if (callback) callback(ev);
  };
  (async () => {
    try {
      const body: Record<string, unknown> = { account };
      if (limit !== undefined) body.limit = limit;
      const res = await fetch(`/api/config/style-panels/distill-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        emit({ type: "distill_all.failed", error: `distill-all HTTP ${res.status}` });
        return;
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
          if (eventMatch) {
            const type = eventMatch[1]!.trim();
            let data: any = undefined;
            if (dataMatch) {
              try { data = JSON.parse(dataMatch[1]!); } catch { data = dataMatch[1]!; }
            }
            emit({ type, data, error: data?.error });
          }
        }
      }
    } catch (err: unknown) {
      emit({ type: "distill_all.failed", error: err instanceof Error ? err.message : String(err) });
    }
  })();
  return {
    onEvent: (cb) => { callback = cb; },
    close: () => controller.abort(),
  };
}

export async function getProjectOverride(projectId: string): Promise<ProjectOverride> {
  const res = await throwingFetch(`/api/projects/${projectId}/override`);
  return res.json();
}

export async function setProjectOverride(
  projectId: string,
  override: ProjectOverride,
): Promise<void> {
  await throwingFetch(`/api/projects/${projectId}/override`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(override),
  });
}

export async function clearProjectAgentOverride(
  projectId: string,
  agentKey: string,
): Promise<void> {
  await throwingFetch(`/api/projects/${projectId}/override/${encodeURIComponent(agentKey)}`, {
    method: "DELETE",
  });
}

export async function rewriteSectionStream(
  projectId: string,
  key: string,
  userHint: string | undefined,
  onEvent: (ev: { type: string; data: any }) => void,
  selectedText?: string,
): Promise<void> {
  const res = await fetch(`/api/projects/${projectId}/writer/sections/${encodeURIComponent(key)}/rewrite`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_hint: userHint, selected_text: selectedText }),
  });
  if (!res.ok || !res.body) throw new Error(`rewrite failed: ${res.status}`);
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
        try {
          onEvent({ type: eventMatch[1]!.trim(), data: JSON.parse(dataMatch[1]!) });
        } catch {
          onEvent({ type: eventMatch[1]!.trim(), data: dataMatch[1]! });
        }
      }
    }
  }
}

// ============================================================================
// SP-12: Topic Expert APIs
// ============================================================================

export interface TopicExpertMeta {
  name: string;
  specialty: string;
  active: boolean;
  default_preselect: boolean;
  soft_deleted: boolean;
  updated_at?: string;
  distilled_at?: string;
  version?: number;
}

export interface TopicExpertDetail extends TopicExpertMeta {
  kb_markdown: string;
  word_count: number;
}

export type TopicExpertInvokeType = "score" | "structure" | "continue";

export async function listTopicExperts(
  opts?: { includeDeleted?: boolean },
): Promise<{ experts: TopicExpertMeta[] }> {
  const qs = opts?.includeDeleted ? "?include_deleted=1" : "";
  const res = await throwingFetch(`/api/topic-experts${qs}`);
  return res.json();
}

export async function getTopicExpert(name: string): Promise<TopicExpertDetail> {
  const res = await throwingFetch(`/api/topic-experts/${encodeURIComponent(name)}`);
  return res.json();
}

export async function setTopicExpert(
  name: string,
  patch: Partial<Pick<TopicExpertMeta, "active" | "default_preselect" | "specialty">> & {
    kb_markdown?: string;
  },
): Promise<{ ok: true; expert: TopicExpertMeta }> {
  const res = await throwingFetch(`/api/topic-experts/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return res.json();
}

export async function createTopicExpert(body: {
  name: string;
  specialty: string;
  seed_urls?: string[];
}): Promise<{ ok: true; expert: TopicExpertMeta; job_id: string | null }> {
  const res = await throwingFetch(`/api/topic-experts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function deleteTopicExpert(
  name: string,
  opts?: { mode?: "soft" | "hard" },
): Promise<{ ok: true; mode: "soft" | "hard" }> {
  const mode = opts?.mode ?? "soft";
  const res = await throwingFetch(
    `/api/topic-experts/${encodeURIComponent(name)}?mode=${mode}`,
    { method: "DELETE" },
  );
  return res.json();
}

export interface TopicExpertSseHandlers {
  onEvent: (type: string, data: unknown) => void;
  onError?: (e: Error) => void;
  onClose?: () => void;
}

function openTopicExpertSse(
  url: string,
  body: unknown,
  handlers: TopicExpertSseHandlers,
): { abort: () => void } {
  const controller = new AbortController();
  (async () => {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        handlers.onError?.(new Error(`${url} → HTTP ${res.status}`));
        handlers.onClose?.();
        return;
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
          if (eventMatch) {
            const type = eventMatch[1]!.trim();
            let data: unknown = undefined;
            if (dataMatch) {
              try { data = JSON.parse(dataMatch[1]!); } catch { data = dataMatch[1]!; }
            }
            handlers.onEvent(type, data);
          }
        }
      }
      handlers.onClose?.();
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        handlers.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
      handlers.onClose?.();
    }
  })();
  return { abort: () => controller.abort() };
}

export function distillTopicExpert(
  name: string,
  body: { seed_urls?: string[]; mode?: "initial" | "redistill" },
  handlers: TopicExpertSseHandlers,
): { abort: () => void } {
  return openTopicExpertSse(
    `/api/topic-experts/${encodeURIComponent(name)}/distill`,
    body,
    handlers,
  );
}

export function consultTopicExperts(
  projectId: string,
  body: {
    selected: string[];
    invokeType: TopicExpertInvokeType;
    brief?: string;
    productContext?: string;
    candidatesMd?: string;
    currentDraft?: string;
    focus?: string;
  },
  handlers: TopicExpertSseHandlers,
): { abort: () => void } {
  return openTopicExpertSse(
    `/api/projects/${encodeURIComponent(projectId)}/topic-experts/consult`,
    body,
    handlers,
  );
}

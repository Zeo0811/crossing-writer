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

export async function putSection(projectId: string, key: string, body: string): Promise<void> {
  await throwingFetch(`/api/projects/${projectId}/writer/sections/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
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

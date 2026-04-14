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

export type SkillResult =
  | {
      ok: true;
      tool: string;
      query: string;
      args: Record<string, string>;
      hits: unknown[];
      hits_count: number;
      formatted: string;
    }
  | {
      ok: false;
      tool: string;
      query: string;
      args: Record<string, string>;
      error: string;
    };

export async function callSkill(
  projectId: string,
  sectionKey: string,
  tool: string,
  args: Record<string, string>,
): Promise<SkillResult> {
  const res = await fetch(
    `/api/projects/${projectId}/writer/sections/${encodeURIComponent(sectionKey)}/skill`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool, args }),
    },
  );
  if (!res.ok) {
    return {
      ok: false,
      tool,
      query: args.query ?? "",
      args,
      error: `HTTP ${res.status}`,
    };
  }
  return (await res.json()) as SkillResult;
}

export async function getPinned(
  projectId: string,
  sectionKey: string,
): Promise<{ pins: unknown[] }> {
  const res = await fetch(
    `/api/projects/${projectId}/writer/sections/${encodeURIComponent(sectionKey)}/pinned`,
  );
  if (!res.ok) throw new Error(`getPinned HTTP ${res.status}`);
  return (await res.json()) as { pins: unknown[] };
}

export async function deletePin(
  projectId: string,
  sectionKey: string,
  index: number,
): Promise<void> {
  const res = await fetch(
    `/api/projects/${projectId}/writer/sections/${encodeURIComponent(sectionKey)}/pinned/${index}`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error(`deletePin HTTP ${res.status}`);
}

export interface SuggestItem {
  kind: "wiki" | "raw";
  id: string;
  title: string;
  excerpt: string;
  account?: string;
  published_at?: string;
}

export async function suggestRefs(q: string, limit = 12): Promise<SuggestItem[]> {
  const url = `/api/writer/suggest?q=${encodeURIComponent(q)}&limit=${encodeURIComponent(String(limit))}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`suggest failed: ${res.status}`);
  const json = (await res.json()) as { items?: SuggestItem[] };
  return json.items ?? [];
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

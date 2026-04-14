export interface SearchRawInput {
  query: string;
  account?: string;
  limit?: number;
}

export interface SearchRawHit {
  article_id: string;
  account: string;
  title: string;
  published_at: string;
  snippet: string;
}

export type ToolCall = { command: string; args: string[] };

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

export interface SkillContext {
  vaultPath: string;
  sqlitePath: string;
}

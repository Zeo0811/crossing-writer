import { searchRaw } from "./search-raw.js";
import { searchWiki } from "../wiki/search-wiki.js";
import type { SkillContext, SkillResult, ToolCall } from "./types.js";

const MAX_FORMATTED = 20_000;

export function parseSkillArgs(tokens: string[]): { query: string; args: Record<string, string> } {
  const args: Record<string, string> = {};
  let query = "";
  for (const t of tokens) {
    const m = t.match(/^--([a-zA-Z_]+)=(.*)$/);
    if (m) {
      args[m[1]!] = m[2]!;
    } else if (!query) {
      query = stripQuotes(t);
    }
  }
  return { query, args };
}

function stripQuotes(s: string): string {
  if ((s.startsWith("\"") && s.endsWith("\"")) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

export async function dispatchSkill(call: ToolCall, ctx: SkillContext): Promise<SkillResult> {
  const { query, args } = parseSkillArgs(call.args);
  const base = { tool: call.command, query, args } as const;

  try {
    if (call.command === "search_wiki") {
      const limit = parseIntOrUndef(args.limit);
      const hits = await Promise.resolve(
        searchWiki(
          { query, kind: args.kind as any, limit },
          { vaultPath: ctx.vaultPath },
        ),
      );
      return {
        ok: true,
        ...base,
        hits,
        hits_count: hits.length,
        formatted: truncate(formatWikiHits(hits)),
      };
    }
    if (call.command === "search_raw") {
      const limit = parseIntOrUndef(args.limit);
      const hits = searchRaw({ query, account: args.account, limit }, { sqlitePath: ctx.sqlitePath });
      return {
        ok: true,
        ...base,
        hits,
        hits_count: hits.length,
        formatted: truncate(formatRawHits(hits)),
      };
    }
    return { ok: false, ...base, error: `unknown tool: ${call.command}` };
  } catch (e) {
    return { ok: false, ...base, error: (e as Error).message || String(e) };
  }
}

function parseIntOrUndef(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : undefined;
}

function formatWikiHits(hits: any[]): string {
  if (!hits.length) return "(no wiki hits)";
  return hits
    .map((h, i) => `${i + 1}. **${h.title ?? h.path}** (${h.kind ?? "?"}, score=${(h.score ?? 0).toFixed?.(1) ?? h.score})\n   path: ${h.path}\n   ${h.excerpt ?? ""}`.trim())
    .join("\n");
}

function formatRawHits(hits: any[]): string {
  if (!hits.length) return "(no raw hits)";
  return hits
    .map((h, i) => `${i + 1}. **${h.title}** — ${h.account} · ${h.published_at}\n   id: ${h.article_id}\n   ${h.snippet}`.trim())
    .join("\n");
}

function truncate(s: string): string {
  if (s.length <= MAX_FORMATTED) return s;
  return s.slice(0, MAX_FORMATTED) + "\n...(truncated)";
}

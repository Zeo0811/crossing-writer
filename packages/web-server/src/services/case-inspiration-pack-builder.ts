import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { searchRefs, type RefSearchResult } from "./crossing-kb-search.js";

export interface BuildInspirationOpts {
  vaultPath: string;
  sqlitePath: string;
  queries: string[];
  maxSources?: number;
}

const PROMPT_BLOCK_RE = /```(?:text|prompt)?\n([\s\S]*?)\n```/g;
const PROMPT_LABEL_RE = /(?:提示词[如:][:：]?|prompt[:：]?)\s*\n+([^\n]{10,500})/gi;
const STEPS_RE = /(?:测试步骤|步骤|steps)[:：]?\s*\n+((?:\s*\d+\.\s*[^\n]+\n?){1,6})/gi;

function extractPrompts(body: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = PROMPT_BLOCK_RE.exec(body))) {
    const t = m[1]!.trim();
    if (t.length > 10 && t.length < 1000) out.push(t);
  }
  PROMPT_LABEL_RE.lastIndex = 0;
  while ((m = PROMPT_LABEL_RE.exec(body))) {
    out.push(m[1]!.trim());
  }
  return out.slice(0, 3);
}

function extractSteps(body: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  STEPS_RE.lastIndex = 0;
  while ((m = STEPS_RE.exec(body))) {
    out.push(m[1]!.trim());
  }
  return out.slice(0, 2);
}

function sanitizeFtsQuery(q: string): string {
  // FTS5: strip punctuation that acts as operators; keep CJK + alphanum
  const cleaned = q.replace(/[^\p{L}\p{N}\s]+/gu, " ").replace(/\s+/g, " ").trim();
  return cleaned;
}

export async function buildInspirationPack(opts: BuildInspirationOpts): Promise<string> {
  const max = opts.maxSources ?? 15;
  const hits: RefSearchResult[] = [];
  for (const q of opts.queries) {
    const clean = sanitizeFtsQuery(q);
    if (!clean) continue;
    try {
      const r = await searchRefs(opts.sqlitePath, clean, Math.ceil(max / opts.queries.length));
      hits.push(...r);
    } catch (e) {
      // skip bad query, log and continue
      console.warn("[inspiration] searchRefs failed for query:", clean, e);
    }
  }
  const dedupe = new Map<string, RefSearchResult>();
  for (const h of hits) if (!dedupe.has(h.mdPath)) dedupe.set(h.mdPath, h);
  const sources = Array.from(dedupe.values()).slice(0, max);

  const lines: string[] = [];
  lines.push("---");
  lines.push("type: case_inspiration_pack");
  lines.push(`queries: ${JSON.stringify(opts.queries)}`);
  lines.push(`total_sources: ${sources.length}`);
  lines.push("---", "", "# Inspiration Pack", "");

  for (let i = 0; i < sources.length; i += 1) {
    const s = sources[i]!;
    let body = "";
    try {
      body = await readFile(join(opts.vaultPath, s.mdPath), "utf-8");
    } catch {}
    const prompts = extractPrompts(body);
    const steps = extractSteps(body);

    lines.push(`## ${i + 1}. 《${s.title}》— ${s.account} ${s.date}`, "");
    if (prompts.length) {
      lines.push("**Prompts used**:");
      for (const p of prompts) lines.push("```", p, "```", "");
    }
    if (steps.length) {
      lines.push("**Test steps**:");
      for (const st of steps) lines.push(st, "");
    }
    if (!prompts.length && !steps.length) {
      const summary = body.replace(/^---[\s\S]*?---\n/, "").slice(0, 2000);
      lines.push("**Summary (fallback)**:", summary, "");
    }
    lines.push("---", "");
  }
  return lines.join("\n");
}

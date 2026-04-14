import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { invokeAgent } from "../model-adapter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = readFileSync(
  join(__dirname, "../prompts/section-slicer.md"),
  "utf-8",
);

export type SectionRole = "opening" | "practice" | "closing" | "other";
const ROLE_ALLOWLIST: ReadonlySet<string> = new Set([
  "opening",
  "practice",
  "closing",
  "other",
]);

export interface SectionSlice {
  start_char: number;
  end_char: number;
  role: SectionRole;
}

export interface SectionSlicerOpts {
  cli: "claude" | "codex";
  model?: string;
}

export interface SectionSlicerResult {
  slices: SectionSlice[];
  meta: { cli: string; model?: string | null; durationMs: number };
}

function stripCodeFences(raw: string): string {
  let t = raw.trim();
  if (t.startsWith("```")) {
    // drop opening fence line (```json or ```)
    const nl = t.indexOf("\n");
    if (nl >= 0) t = t.slice(nl + 1);
    // drop trailing fence
    if (t.endsWith("```")) t = t.slice(0, -3);
  }
  return t.trim();
}

function sanitizeSlices(raw: unknown, bodyLen: number): SectionSlice[] {
  if (!Array.isArray(raw)) return [];
  const candidates: SectionSlice[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const start = r.start_char;
    const end = r.end_char;
    const role = r.role;
    if (typeof start !== "number" || typeof end !== "number") continue;
    if (typeof role !== "string" || !ROLE_ALLOWLIST.has(role)) continue;
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (start < 0 || end > bodyLen || start >= end) continue;
    candidates.push({
      start_char: Math.floor(start),
      end_char: Math.floor(end),
      role: role as SectionRole,
    });
  }
  // Sort by start; drop entries overlapping any already-accepted span.
  candidates.sort((a, b) => a.start_char - b.start_char);
  const accepted: SectionSlice[] = [];
  for (const c of candidates) {
    const last = accepted[accepted.length - 1];
    if (last && c.start_char < last.end_char) continue; // overlap → drop
    accepted.push(c);
  }
  return accepted;
}

export async function runSectionSlicer(
  articleBody: string,
  opts: SectionSlicerOpts,
): Promise<SectionSlicerResult> {
  if (!articleBody || articleBody.length === 0) {
    return {
      slices: [],
      meta: { cli: opts.cli, model: opts.model ?? null, durationMs: 0 },
    };
  }

  const userMessage = `Article body:\n\n${articleBody}`;

  const result = invokeAgent({
    agentKey: "section_slicer",
    cli: opts.cli,
    model: opts.model,
    systemPrompt: SYSTEM_PROMPT,
    userMessage,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFences(result.text));
  } catch (err) {
    console.warn(
      `[section-slicer] failed to parse JSON: ${(err as Error).message}`,
    );
    return {
      slices: [],
      meta: {
        cli: result.meta.cli,
        model: result.meta.model ?? null,
        durationMs: result.meta.durationMs,
      },
    };
  }

  const slices = sanitizeSlices(parsed, articleBody.length);
  return {
    slices,
    meta: {
      cli: result.meta.cli,
      model: result.meta.model ?? null,
      durationMs: result.meta.durationMs,
    },
  };
}

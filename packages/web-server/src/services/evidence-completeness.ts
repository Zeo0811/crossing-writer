import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export interface CompletenessResult {
  complete: boolean;
  missing: Array<"screenshot" | "notes" | "generated">;
  has_screenshot: boolean;
  has_notes: boolean;
  has_generated: boolean;
}

function dirHasFiles(p: string): boolean {
  if (!existsSync(p)) return false;
  try {
    const entries = readdirSync(p);
    return entries.some((e) => {
      const full = join(p, e);
      return statSync(full).isFile();
    });
  } catch {
    return false;
  }
}

function notesHasContent(notesPath: string): boolean {
  if (!existsSync(notesPath)) return false;
  try {
    const raw = readFileSync(notesPath, "utf-8");
    const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!m) return false;
    const fm = m[1] ?? "";
    const body = (m[2] ?? "").trim();
    if (body.length > 0) return true;
    // observations counted as content too
    return /observations\s*:\s*\n\s*-/.test(fm);
  } catch {
    return false;
  }
}

export function computeCompleteness(caseDir: string): CompletenessResult {
  const has_screenshot = dirHasFiles(join(caseDir, "screenshots"));
  const has_generated = dirHasFiles(join(caseDir, "generated"));
  const has_notes = notesHasContent(join(caseDir, "notes.md"));

  const missing: CompletenessResult["missing"] = [];
  if (!has_screenshot) missing.push("screenshot");
  if (!has_notes) missing.push("notes");
  if (!has_generated) missing.push("generated");

  return {
    complete: missing.length === 0,
    missing,
    has_screenshot,
    has_notes,
    has_generated,
  };
}

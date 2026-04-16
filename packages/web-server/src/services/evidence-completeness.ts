import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export interface CompletenessResult {
  complete: boolean;
  missing: Array<"material" | "notes">;
  has_screenshot: boolean;
  has_notes: boolean;
  has_generated: boolean;
  has_recording: boolean;
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
  const has_recording = dirHasFiles(join(caseDir, "recordings"));
  const has_notes = notesHasContent(join(caseDir, "notes.md"));

  // Loosest rule: a case counts as "complete" when the user has provided ANY
  // evidence at all — one screenshot, one recording, one generated artifact,
  // or written notes. Evidence stage is user-driven; the system shouldn't
  // gate-keep what "enough" means per case.
  const has_any = has_screenshot || has_generated || has_recording || has_notes;
  const missing: CompletenessResult["missing"] = [];
  if (!has_any) missing.push("material");

  return {
    complete: missing.length === 0,
    missing,
    has_screenshot,
    has_notes,
    has_generated,
    has_recording,
  };
}

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

  // Loose rule: a case is "complete" when the user has (a) at least ONE piece
  // of evidence (screenshot / generated / recording) AND (b) some notes.
  // Previously required all three material types, which pushed users to
  // pad empty uploads just to clear the gate.
  const has_any_material = has_screenshot || has_generated || has_recording;
  const missing: CompletenessResult["missing"] = [];
  if (!has_any_material) missing.push("material");
  if (!has_notes) missing.push("notes");

  return {
    complete: missing.length === 0,
    missing,
    has_screenshot,
    has_notes,
    has_generated,
    has_recording,
  };
}

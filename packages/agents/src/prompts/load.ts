import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export function loadPromptInclude(name: string): string {
  return readFileSync(join(here, name), "utf-8").trim();
}

export const TOOL_PROTOCOL_PROMPT = loadPromptInclude("_tool-protocol.md");

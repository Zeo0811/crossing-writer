import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getSystemPrompt as openingPrompt } from "../src/roles/writer-opening-agent.js";
import { getSystemPrompt as practicePrompt } from "../src/roles/writer-practice-agent.js";
import { getSystemPrompt as closingPrompt } from "../src/roles/writer-closing-agent.js";
import { getSystemPrompt as criticPrompt } from "../src/roles/style-critic-agent.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const protocolPath = join(__dirname, "..", "src", "prompts", "_tool-protocol.md");

describe("_tool-protocol.md", () => {
  it("exists and contains tool syntax", () => {
    expect(existsSync(protocolPath)).toBe(true);
    const body = readFileSync(protocolPath, "utf-8");
    expect(body).toContain("search_wiki");
    expect(body).toContain("search_raw");
    expect(body).toContain("```tool");
    expect(body).toMatch(/5\s*round/);
  });
});

describe("4 writer agents include tool-protocol", () => {
  const marker = "工具调用协议";
  it("writer.opening", () => expect(openingPrompt()).toContain(marker));
  it("writer.practice", () => expect(practicePrompt()).toContain(marker));
  it("writer.closing", () => expect(closingPrompt()).toContain(marker));
  it("style_critic", () => expect(criticPrompt()).toContain(marker));
});

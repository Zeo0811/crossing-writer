import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderBookendPrompt, type PanelFrontmatterLike } from "../src/roles/writer-shared.js";
import { TOOL_PROTOCOL_PROMPT } from "../src/prompts/load.js";
import { getSystemPrompt as practicePrompt } from "../src/roles/writer-practice-agent.js";
import { getSystemPrompt as criticPrompt } from "../src/roles/style-critic-agent.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const protocolPath = join(__dirname, "..", "src", "prompts", "_tool-protocol.md");

/** Minimal PanelFrontmatterLike for rendering the bookend prompt in tests */
const STUB_PANEL: PanelFrontmatterLike = {
  word_count_ranges: { opening: [100, 200], article: [800, 1200] },
  pronoun_policy: { we_ratio: 0.5, you_ratio: 0.5, avoid: [] },
  tone: { primary: "conversational", humor_frequency: "low", opinionated: "moderate" },
  bold_policy: { frequency: "low", what_to_bold: [], dont_bold: [] },
  transition_phrases: [],
  data_citation: { required: true, format_style: "inline", min_per_article: 1 },
};

function bookendPrompt(role: "opening" | "closing"): string {
  const base = renderBookendPrompt({
    role,
    account: "test-account",
    articleType: "实测",
    typeSection: "",
    panelFrontmatter: STUB_PANEL,
    hardRulesBlock: "",
    projectContextBlock: "",
  });
  return `${base}\n\n${TOOL_PROTOCOL_PROMPT}`;
}

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
  it("writer.opening", () => expect(bookendPrompt("opening")).toContain(marker));
  it("writer.practice", () => expect(practicePrompt()).toContain(marker));
  it("writer.closing", () => expect(bookendPrompt("closing")).toContain(marker));
  it("style_critic", () => expect(criticPrompt()).toContain(marker));
});

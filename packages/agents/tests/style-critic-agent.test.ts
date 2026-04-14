import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/model-adapter.js", () => ({
  invokeAgent: vi.fn(),
}));

import { invokeAgent } from "../src/model-adapter.js";
import { StyleCriticAgent } from "../src/roles/style-critic-agent.js";

describe("StyleCriticAgent", () => {
  beforeEach(() => {
    (invokeAgent as any).mockReset();
  });

  it("parses section_key → new md from agent output", async () => {
    (invokeAgent as any).mockReturnValue({
      text: [
        "## REWRITE section:opening",
        "新的开头…",
        "",
        "## REWRITE section:practice.case-02",
        "新的 case-02 正文",
        "",
        "## REWRITE section:closing",
        "新结尾",
      ].join("\n"),
      meta: { cli: "claude", model: "opus", durationMs: 3000 },
    });

    const agent = new StyleCriticAgent({ cli: "claude", model: "opus" });
    const out = await agent.critique({
      fullArticle: "<整篇内容>",
      sectionKeys: ["opening", "practice.case-01", "practice.case-02", "closing"],
      referenceAccountsKb: [{ id: "赛博禅心", text: "【风格基准】" }],
    });

    expect(out.rewrites["opening"]).toContain("新的开头");
    expect(out.rewrites["practice.case-02"]).toContain("新的 case-02");
    expect(out.rewrites["closing"]).toContain("新结尾");
    expect(out.rewrites["practice.case-01"]).toBeUndefined();
  });

  it("returns empty rewrites when agent declares no changes", async () => {
    (invokeAgent as any).mockReturnValue({
      text: "NO_CHANGES",
      meta: { cli: "claude", model: "opus", durationMs: 400 },
    });
    const agent = new StyleCriticAgent({ cli: "claude", model: "opus" });
    const out = await agent.critique({
      fullArticle: "x",
      sectionKeys: ["opening"],
      referenceAccountsKb: [],
    });
    expect(out.rewrites).toEqual({});
  });
});

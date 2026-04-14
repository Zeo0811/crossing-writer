import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/model-adapter.js", () => ({
  invokeAgent: vi.fn(),
}));

import { invokeAgent } from "../src/model-adapter.js";
import { StyleDistillerComposerAgent } from "../src/roles/style-distiller-composer-agent.js";

describe("StyleDistillerComposerAgent", () => {
  beforeEach(() => { (invokeAgent as any).mockReset(); });

  it("builds kb.md with frontmatter containing all metadata", async () => {
    (invokeAgent as any).mockReturnValue({
      text: "# 正文内容\n一、核心定位\n...",
      meta: { cli: "claude", model: "opus", durationMs: 2000 },
    });
    const agent = new StyleDistillerComposerAgent({ cli: "claude", model: "opus" });
    const out = await agent.compose({
      account: "赛博禅心",
      sampleSizeRequested: 100,
      sampleSizeActual: 87,
      sourcePoolSize: 314,
      articleDateRange: { start: "2025-01-01", end: "2026-04-01" },
      distilledAt: "2026-04-14T15:30:00Z",
      stepClis: { structure: { cli: "claude", model: "opus" }, snippets: { cli: "claude", model: "opus" }, composer: { cli: "claude", model: "opus" } },
      deepReadIds: ["2025-08-15_X", "2025-11-20_Y"],
      quantJson: '{"article_count":87}',
      structureMd: "一、核心定位\n...",
      snippetsYaml: "opening.data:\n  - from: a\n    excerpt: 据 X",
    });
    expect(out.kbMd.startsWith("---\n")).toBe(true);
    expect(out.kbMd).toContain("type: style_expert");
    expect(out.kbMd).toContain("account: 赛博禅心");
    expect(out.kbMd).toContain("version: v2");
    expect(out.kbMd).toContain("sample_size_requested: 100");
    expect(out.kbMd).toContain("sample_size_actual: 87");
    expect(out.kbMd).toContain("2025-08-15_X");
    expect(out.kbMd).toContain("# 正文内容");
    const call = (invokeAgent as any).mock.calls[0][0];
    expect(call.userMessage).toContain("一、核心定位");
    expect(call.userMessage).toContain("opening.data");
  });
});

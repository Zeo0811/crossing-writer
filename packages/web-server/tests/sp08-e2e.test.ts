import { describe, it, expect, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runWriterBookend } from "@crossing/agents";
import { ArticleStore } from "../src/services/article-store.js";
import type { ToolCall, SkillResult, WriterToolEvent } from "@crossing/agents";

const STUB_PANEL = {
  word_count_ranges: { opening: [100, 200] as [number, number], article: [800, 1200] as [number, number] },
  pronoun_policy: { we_ratio: 0.5, you_ratio: 0.5, avoid: [] as string[] },
  tone: { primary: "conversational", humor_frequency: "low", opinionated: "moderate" },
  bold_policy: { frequency: "low", what_to_bold: [] as string[], dont_bold: [] as string[] },
  transition_phrases: [] as string[],
  data_citation: { required: true, format_style: "inline", min_per_article: 1 },
};

describe("sp08 e2e: writer-opening (bookend) with tools → store + events", () => {
  it("multi-round tool use lands in frontmatter and emits 4 event types", async () => {
    const events: WriterToolEvent[] = [];
    const dir = mkdtempSync(join(tmpdir(), "sp08e2e-"));
    const store = new ArticleStore(dir);
    await store.init();

    // Mock invokeAgent: round1 → 1 tool call; round2 → 2 tool calls (one will fail); round3 → final content.
    const invokeAgent = vi.fn<any>()
      .mockResolvedValueOnce({
        text: '```tool\nsearch_raw "a"\n```',
        meta: { cli: "claude", model: "opus", durationMs: 1 },
      })
      .mockResolvedValueOnce({
        text: [
          '```tool',
          'search_raw "b"',
          '```',
          '```tool',
          'fetch_url "https://x" --timeout=5',
          '```',
        ].join("\n"),
        meta: { cli: "claude", model: "opus", durationMs: 1 },
      })
      .mockResolvedValueOnce({
        text: "# 开场\n\n正文...",
        meta: { cli: "claude", model: "opus", durationMs: 1 },
      });

    const dispatchTool = vi.fn(async (call: ToolCall): Promise<SkillResult> => {
      if (call.command === "fetch_url") {
        return {
          ok: false,
          tool: "fetch_url",
          query: call.args[0]?.replace(/"/g, "") ?? "",
          args: {},
          error: "net timeout",
        };
      }
      return {
        ok: true,
        tool: call.command,
        query: call.args[0]?.replace(/"/g, "") ?? "",
        args: {},
        hits: [{ path: "a.md", title: "A", score: 0.8 }],
        hits_count: 1,
        formatted: `hit for ${call.args[0]}`,
      };
    });

    const result = await runWriterBookend({
      role: "opening",
      sectionKey: "opening",
      account: "test-account",
      articleType: "实测",
      typeSection: "",
      panelFrontmatter: STUB_PANEL,
      hardRulesBlock: "",
      projectContextBlock: "",
      invokeAgent,
      userMessage: "写一篇关于 A 的文章",
      dispatchTool,
      maxRounds: 4,
      onEvent: (ev) => events.push(ev),
    });

    expect(result.finalText).toContain("开场");
    expect(result.toolsUsed.length).toBeGreaterThanOrEqual(2);

    await store.writeSection("opening", {
      key: "opening",
      frontmatter: {
        section: "opening",
        last_agent: "writer.opening",
        last_updated_at: new Date().toISOString(),
        tools_used: result.toolsUsed,
      } as any,
      body: result.finalText,
    });
    const read = await store.readSection("opening");
    expect((read!.frontmatter as any).tools_used.length).toBe(result.toolsUsed.length);

    const types = new Set(events.map((e) => e.type));
    expect(types.has("tool_called")).toBe(true);
    expect(types.has("tool_returned")).toBe(true);
    expect(types.has("tool_failed")).toBe(true);
    expect(types.has("tool_round_completed")).toBe(true);
  });
});

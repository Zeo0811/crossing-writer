import { describe, it, expect, vi } from "vitest";
import { runWriterWithTools } from "../src/writer-tool-runner.js";
import type { AgentInvoker, WriterToolEvent } from "../src/writer-tool-runner.js";

function makeInvoker(replies: string[]): AgentInvoker {
  let i = 0;
  return {
    invoke: vi.fn(async () => ({
      text: replies[i++] ?? "",
      meta: { cli: "claude", model: "opus", durationMs: 10 },
    })),
  };
}

describe("runWriterWithTools", () => {
  it("returns immediately when first reply has no tool block", async () => {
    const agent = makeInvoker(["这是最终段落"]);
    const result = await runWriterWithTools({
      agent,
      agentName: "writer.opening",
      systemPrompt: "sys",
      initialUserMessage: "写开头",
      dispatchTool: async () => { throw new Error("should not call"); },
    });
    expect(result.finalText).toBe("这是最终段落");
    expect(result.rounds).toBe(1);
    expect(result.toolsUsed).toEqual([]);
  });

  it("runs multi-round dialog and aggregates tools", async () => {
    const agent = makeInvoker([
      "我先查查\n```tool\nsearch_wiki \"AI 漫剧\" --kind=concept\n```",
      "再查一个\n```tool\nsearch_raw \"PixVerse\" --limit=2\n```",
      "好了这是最终段落。",
    ]);
    const dispatchTool = vi.fn(async (call) => ({
      ok: true as const,
      tool: call.command,
      query: "x",
      args: {},
      hits: [{ path: "a.md", title: "A" }],
      hits_count: 1,
      formatted: `[${call.command} fake result]`,
    }));
    const events: WriterToolEvent[] = [];
    const result = await runWriterWithTools({
      agent, agentName: "writer.opening",
      systemPrompt: "sys", initialUserMessage: "写",
      dispatchTool, onEvent: (e) => events.push(e),
    });
    expect(result.rounds).toBe(3);
    expect(result.finalText).toBe("好了这是最终段落。");
    expect(result.toolsUsed).toHaveLength(2);
    expect(result.toolsUsed[0]!.tool).toBe("search_wiki");
    expect(result.toolsUsed[1]!.tool).toBe("search_raw");
    expect(events.some((e) => e.type === "tool_called")).toBe(true);
    expect(events.some((e) => e.type === "tool_returned")).toBe(true);
    expect(events.some((e) => e.type === "tool_round_completed")).toBe(true);
  });

  it("stops at maxRounds and returns last assistant text", async () => {
    const replies = Array.from({ length: 10 }, (_, i) => `round ${i}\n\`\`\`tool\nsearch_wiki "q"\n\`\`\``);
    const agent = makeInvoker(replies);
    const dispatchTool = async () => ({
      ok: true as const, tool: "search_wiki", query: "q", args: {},
      hits: [], hits_count: 0, formatted: "()",
    });
    const result = await runWriterWithTools({
      agent, agentName: "writer.opening",
      systemPrompt: "s", initialUserMessage: "u",
      dispatchTool, maxRounds: 3,
    });
    expect(result.rounds).toBe(3);
    expect(result.finalText).toContain("round 2");
  });

  it("continues round when a tool fails", async () => {
    const agent = makeInvoker([
      "```tool\nsearch_wiki \"a\"\nsearch_foo \"b\"\n```",
      "完成。",
    ]);
    const dispatchTool = vi.fn(async (call) => {
      if (call.command === "search_foo") {
        return { ok: false as const, tool: "search_foo", query: "b", args: {}, error: "unknown" };
      }
      return { ok: true as const, tool: "search_wiki", query: "a", args: {}, hits: [], hits_count: 0, formatted: "()" };
    });
    const events: WriterToolEvent[] = [];
    const result = await runWriterWithTools({
      agent, agentName: "writer.opening",
      systemPrompt: "s", initialUserMessage: "u",
      dispatchTool, onEvent: (e) => events.push(e),
    });
    expect(result.finalText).toBe("完成。");
    expect(result.toolsUsed).toHaveLength(2);
    expect(events.some((e) => e.type === "tool_failed")).toBe(true);
  });
});

describe("WriterToolEvent discriminated union: selection_rewritten branch", () => {
  it("can construct a selection_rewritten event and narrow by type tag", () => {
    const ev: WriterToolEvent = {
      type: "selection_rewritten",
      sectionKey: "opening",
      selected_text: "原文片段",
      new_text: "改写后的段落",
      ts: "2026-04-14T00:00:00.000Z",
    };
    // type-level narrowing assertion (compile-time + runtime checks)
    if (ev.type === "selection_rewritten") {
      expect(ev.sectionKey).toBe("opening");
      expect(ev.selected_text).toBe("原文片段");
      expect(ev.new_text).toBe("改写后的段落");
      expect(ev.ts).toBe("2026-04-14T00:00:00.000Z");
    } else {
      throw new Error("expected selection_rewritten branch");
    }
  });

  it("preserves existing tool_called branch shape", () => {
    const ev: WriterToolEvent = {
      type: "tool_called",
      agent: "writer.opening",
      round: 1,
      tool: "search_wiki",
      args: { q: "x" },
      section_key: "opening",
    };
    if (ev.type === "tool_called") {
      expect(ev.agent).toBe("writer.opening");
      expect(ev.round).toBe(1);
      expect(ev.section_key).toBe("opening");
    }
  });

  it("roundtrips a selection_rewritten event through JSON", () => {
    const ev: WriterToolEvent = {
      type: "selection_rewritten",
      sectionKey: "practice",
      selected_text: "A",
      new_text: "B",
      ts: "2026-04-14T12:00:00.000Z",
    };
    const parsed = JSON.parse(JSON.stringify(ev)) as WriterToolEvent;
    expect(parsed.type).toBe("selection_rewritten");
    if (parsed.type === "selection_rewritten") {
      expect(parsed.new_text).toBe("B");
    }
  });
});

describe("runWriterWithTools pinnedContext + edge cases", () => {
  it("injects pinnedContext into system prompt", async () => {
    const captured: any[] = [];
    const agent = {
      invoke: vi.fn(async (messages: any) => {
        captured.push(messages[0]);
        return { text: "done", meta: { cli: "claude", durationMs: 1 } };
      }),
    };
    await runWriterWithTools({
      agent,
      agentName: "w",
      systemPrompt: "BASE",
      initialUserMessage: "go",
      pinnedContext: "PIN_XYZ",
      dispatchTool: async () => { throw new Error("no"); },
    });
    expect(captured[0].content).toContain("BASE");
    expect(captured[0].content).toContain("User-pinned references");
    expect(captured[0].content).toContain("PIN_XYZ");
  });

  it("does not append section when pinnedContext empty", async () => {
    const captured: any[] = [];
    const agent = {
      invoke: vi.fn(async (messages: any) => {
        captured.push(messages[0]);
        return { text: "done", meta: { cli: "claude", durationMs: 1 } };
      }),
    };
    await runWriterWithTools({
      agent, agentName: "w",
      systemPrompt: "BASE",
      initialUserMessage: "go",
      dispatchTool: async () => { throw new Error("no"); },
    });
    expect(captured[0].content).not.toContain("User-pinned references");
  });

  it("accumulates total_duration_ms across rounds", async () => {
    let i = 0;
    const replies = ["```tool\nsearch_wiki \"a\"\n```", "done"];
    const agent = {
      invoke: vi.fn(async () => ({
        text: replies[i++]!,
        meta: { cli: "claude", model: "opus", durationMs: 100 },
      })),
    };
    const r = await runWriterWithTools({
      agent, agentName: "w",
      systemPrompt: "s", initialUserMessage: "u",
      dispatchTool: async () => ({
        ok: true as const, tool: "search_wiki", query: "a", args: {},
        hits: [], hits_count: 0, formatted: "()",
      }),
    });
    expect(r.meta.total_duration_ms).toBe(200);
  });
});

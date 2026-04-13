import { describe, it, expect, vi } from "vitest";
import { runCaseExpert, parseToolCalls } from "../src/case-expert-runner.js";

describe("parseToolCalls", () => {
  it("parses single crossing-kb search tool block", () => {
    const text = `# Case 1
some body
\`\`\`tool
crossing-kb search "AI 视频 实测" --account=卡兹克 --limit=5
\`\`\`
`;
    const calls = parseToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.command).toBe("crossing-kb");
    expect(calls[0]!.args[0]).toBe("search");
    expect(calls[0]!.query).toBe("AI 视频 实测");
    expect(calls[0]!.account).toBe("卡兹克");
    expect(calls[0]!.limit).toBe(5);
  });

  it("returns empty when no tool block", () => {
    expect(parseToolCalls("no tool here")).toEqual([]);
  });

  it("caps at 1 call (ignore extras)", () => {
    const text = `\`\`\`tool
crossing-kb search "a"
\`\`\`
\`\`\`tool
crossing-kb search "b"
\`\`\``;
    expect(parseToolCalls(text)).toHaveLength(1);
  });
});

describe("runCaseExpert", () => {
  it("no tool call → round1 only", async () => {
    const expert = {
      name: "A",
      round1: vi.fn(async () => ({ text: "# Case 1\nno tool", meta: {} as any })),
      round2: vi.fn(),
    } as any;
    const runToolFn = vi.fn();
    const result = await runCaseExpert(expert, {
      missionSummary: "m", productOverview: "o", inspirationPack: "i",
    }, runToolFn);
    expect(result.roundsUsed).toBe(1);
    expect(expert.round2).not.toHaveBeenCalled();
    expect(runToolFn).not.toHaveBeenCalled();
    expect(result.final.text).toContain("no tool");
  });

  it("with tool call → round1 + tool + round2", async () => {
    const expert = {
      name: "A",
      round1: vi.fn(async () => ({
        text: "# Case 1\n```tool\ncrossing-kb search \"x\"\n```",
        meta: {} as any,
      })),
      round2: vi.fn(async () => ({ text: "# Case 1 refined", meta: {} as any })),
    } as any;
    const runToolFn = vi.fn(async () => "tool-results-body");
    const result = await runCaseExpert(expert, {
      missionSummary: "m", productOverview: "o", inspirationPack: "i",
    }, runToolFn);
    expect(result.roundsUsed).toBe(2);
    expect(runToolFn).toHaveBeenCalledWith([{ command: "crossing-kb", args: ["search"], query: "x", account: undefined, limit: undefined }]);
    expect(expert.round2).toHaveBeenCalled();
    expect(result.final.text).toContain("refined");
    expect(result.toolCallsMade).toHaveLength(1);
  });

  it("tool failure → fallback empty, round2 still runs", async () => {
    const expert = {
      name: "A",
      round1: vi.fn(async () => ({
        text: "```tool\ncrossing-kb search \"x\"\n```",
        meta: {} as any,
      })),
      round2: vi.fn(async () => ({ text: "fallback refined", meta: {} as any })),
    } as any;
    const runToolFn = vi.fn(async () => { throw new Error("kb timeout"); });
    const result = await runCaseExpert(expert, {
      missionSummary: "m", productOverview: "o", inspirationPack: "i",
    }, runToolFn);
    expect(result.roundsUsed).toBe(2);
    expect(expert.round2).toHaveBeenCalled();
    const arg = expert.round2.mock.calls[0][0];
    expect(arg.toolResults).toMatch(/\(no results|empty|error/i);
  });
});

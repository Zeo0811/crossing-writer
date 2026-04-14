import { describe, it, expect } from "vitest";
import { aggregateSnippets } from "../../src/style-distiller/snippet-aggregator.js";
import type { SnippetCandidate } from "../../src/style-distiller/types.js";

function mk(tag: string, from: string, excerpt: string, pos = 0.1, length?: number): SnippetCandidate {
  return { tag, from, excerpt, position_ratio: pos, length: length ?? excerpt.length };
}

describe("snippet-aggregator", () => {
  it("dedupes by normalized excerpt hash (whitespace + case)", () => {
    const input = [
      mk("opening.data", "a1", "  据 Monnfox 统计，25 亿次。  "),
      mk("opening.data", "a2", "据 Monnfox 统计，25 亿次。"),
      mk("opening.data", "a3", "据 MONNFOX 统计，25 亿次。"),
    ];
    const out = aggregateSnippets(input);
    expect(out["opening.data"]!.length).toBe(1);
  });

  it("groups by tag and caps each tag at 10", () => {
    const input: SnippetCandidate[] = [];
    for (let i = 0; i < 15; i += 1) input.push(mk("bold.judgment", `a${i}`, `不是 X${i}，而是 Y${i}`));
    for (let i = 0; i < 5; i += 1) input.push(mk("closing.blank", `b${i}`, `这场竞赛刚刚开始${i}`));
    const out = aggregateSnippets(input);
    expect(out["bold.judgment"]!.length).toBe(10);
    expect(out["closing.blank"]!.length).toBe(5);
  });

  it("ranks by score: prefer typical position + longer length", () => {
    const input: SnippetCandidate[] = [
      mk("opening.data", "a1", "短的开头", 0.05, 10),
      mk("opening.data", "a2", "稍长一点的开头句式示例", 0.05, 20),
      mk("opening.data", "a3", "位置不太像开头的句子", 0.6, 20),
    ];
    const out = aggregateSnippets(input);
    expect(out["opening.data"]![0]!.from).toBe("a2");
    expect(out["opening.data"]![out["opening.data"]!.length - 1]!.from).toBe("a3");
  });

  it("produces at least 3 per tag if input has >= 3 unique", () => {
    const input: SnippetCandidate[] = [
      mk("transition.case", "a1", "回到现场"),
      mk("transition.case", "a2", "说回正题"),
      mk("transition.case", "a3", "另一个线索"),
      mk("transition.case", "a4", "同时值得一提"),
    ];
    const out = aggregateSnippets(input);
    expect(out["transition.case"]!.length).toBeGreaterThanOrEqual(3);
  });
});

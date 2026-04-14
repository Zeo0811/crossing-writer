import { describe, it, expect } from "vitest";
import { analyzeQuant } from "../../src/style-distiller/quant-analyzer.js";
import type { ArticleSample } from "../../src/style-distiller/types.js";

function mk(id: string, body: string, published = "2025-06-01", wc?: number): ArticleSample {
  return {
    id,
    account: "test",
    title: id,
    published_at: published,
    word_count: wc ?? body.length,
    body_plain: body,
  };
}

describe("quant-analyzer", () => {
  it("computes basic word_count percentiles", () => {
    const samples = [
      mk("a", "x".repeat(1000), "2025-01-01", 1000),
      mk("b", "y".repeat(2000), "2025-02-01", 2000),
      mk("c", "z".repeat(3000), "2025-03-01", 3000),
      mk("d", "w".repeat(4000), "2025-04-01", 4000),
      mk("e", "v".repeat(5000), "2025-05-01", 5000),
    ];
    const q = analyzeQuant("test", samples);
    expect(q.article_count).toBe(5);
    expect(q.word_count.median).toBe(3000);
    expect(q.word_count.p10).toBeLessThanOrEqual(1500);
    expect(q.word_count.p90).toBeGreaterThanOrEqual(4500);
  });

  it("detects emojis and counts density per emoji", () => {
    const samples = [
      mk("a", "开头🚥数据\n正文🚥总结"),
      mk("b", "纯文"),
    ];
    const q = analyzeQuant("test", samples);
    expect(q.emoji_density["🚥"]).toBeCloseTo(1, 1);
  });

  it("computes pronoun ratio (we / you / none)", () => {
    const samples = [
      mk("a", "我们看到这个产品"),
      mk("b", "你会发现这个功能很棒"),
      mk("c", "这款产品值得关注"),
    ];
    const q = analyzeQuant("test", samples);
    expect(q.pronoun_ratio.we + q.pronoun_ratio.you + q.pronoun_ratio.none).toBeCloseTo(1, 2);
    expect(q.pronoun_ratio.we).toBeGreaterThan(0);
    expect(q.pronoun_ratio.you).toBeGreaterThan(0);
    expect(q.pronoun_ratio.none).toBeGreaterThan(0);
  });

  it("counts bold frequency per section (## headers)", () => {
    const body = [
      "## 第一节", "**加粗一**", "正文", "**加粗二**",
      "## 第二节", "正文无加粗",
    ].join("\n");
    const q = analyzeQuant("test", [mk("a", body)]);
    expect(q.bold_per_section.median).toBeGreaterThan(0);
    expect(q.bold_per_section.median).toBeLessThanOrEqual(2);
  });

  it("computes image_to_text_ratio (chars per image)", () => {
    const body = "正文".repeat(100) + "\n![](img1.png)\n" + "尾巴".repeat(50);
    const q = analyzeQuant("test", [mk("a", body)]);
    expect(q.image_to_text_ratio).toBeGreaterThan(100);
  });

  it("extracts top transition words", () => {
    const body = "首先这样。其次那样。然而这样。但是那样。其次又一次。";
    const q = analyzeQuant("test", [mk("a", body)]);
    const words = q.top_transition_words.map((t) => t.word);
    expect(words).toContain("其次");
  });

  it("returns date_range across samples", () => {
    const samples = [
      mk("a", "x", "2025-01-15"),
      mk("b", "y", "2026-02-20"),
    ];
    const q = analyzeQuant("test", samples);
    expect(q.date_range.start).toBe("2025-01-15");
    expect(q.date_range.end).toBe("2026-02-20");
  });
});

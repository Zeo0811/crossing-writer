import { describe, it, expect } from "vitest";
import { buildSelectionRewriteUserMessage } from "../src/services/selection-rewrite-builder.js";

describe("buildSelectionRewriteUserMessage", () => {
  it("assembles all sections in order", () => {
    const msg = buildSelectionRewriteUserMessage({
      sectionBody: "BODY",
      selectedText: "SEL",
      userPrompt: "make it better",
      references: [
        { kind: "wiki", id: "a.md", title: "AI.Talk", content: "WIKIBODY" },
        {
          kind: "raw",
          id: "x",
          title: "Top",
          content: "RAWBODY",
          account: "花叔",
          published_at: "2024-08-28",
        },
      ],
    });
    expect(msg).toContain("[段落完整上下文]\nBODY");
    expect(msg).toContain("[需要改写的部分]\nSEL");
    expect(msg).toContain("## [wiki] AI.Talk\nWIKIBODY");
    expect(msg).toContain("## [raw] Top (花叔 2024-08-28)\nRAWBODY");
    expect(msg).toContain("[改写要求]\nmake it better");
    expect(msg.indexOf("[段落完整上下文]")).toBeLessThan(
      msg.indexOf("[引用素材]"),
    );
    expect(msg.indexOf("[引用素材]")).toBeLessThan(
      msg.indexOf("[改写要求]"),
    );
  });

  it("preserves reference ordering", () => {
    const msg = buildSelectionRewriteUserMessage({
      sectionBody: "B",
      selectedText: "S",
      userPrompt: "p",
      references: [
        { kind: "wiki", id: "1", title: "First", content: "one" },
        { kind: "raw", id: "2", title: "Second", content: "two" },
        { kind: "wiki", id: "3", title: "Third", content: "three" },
      ],
    });
    expect(msg.indexOf("First")).toBeLessThan(msg.indexOf("Second"));
    expect(msg.indexOf("Second")).toBeLessThan(msg.indexOf("Third"));
  });

  it("truncates per-ref bodies at 3000 chars", () => {
    const big = "x".repeat(4000);
    const msg = buildSelectionRewriteUserMessage({
      sectionBody: "B",
      selectedText: "S",
      userPrompt: "p",
      references: [{ kind: "wiki", id: "a", title: "A", content: big }],
    });
    expect(msg).toContain("[truncated]");
    expect(msg.match(/x/g)!.length).toBe(3000);
  });

  it("handles empty references", () => {
    const msg = buildSelectionRewriteUserMessage({
      sectionBody: "B",
      selectedText: "S",
      userPrompt: "p",
      references: [],
    });
    expect(msg).toContain("[引用素材]\n(无)");
  });
});

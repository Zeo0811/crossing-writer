import { describe, it, expect } from "vitest";
import { buildSelectionRewriteUserMessage } from "../src/services/selection-rewrite-builder.js";

describe("buildSelectionRewriteUserMessage", () => {
  it("assembles all sections in order", () => {
    const msg = buildSelectionRewriteUserMessage({
      sectionBody: "BODY",
      selectedText: "SEL",
      userPrompt: "make it better",
    });
    expect(msg).toContain("[段落完整上下文]\nBODY");
    expect(msg).toContain("[需要改写的部分]\nSEL");
    expect(msg).toContain("[改写要求]\nmake it better");
    expect(msg.indexOf("[段落完整上下文]")).toBeLessThan(
      msg.indexOf("[需要改写的部分]"),
    );
    expect(msg.indexOf("[需要改写的部分]")).toBeLessThan(
      msg.indexOf("[改写要求]"),
    );
  });

  it("includes agent-side @skill guidance", () => {
    const msg = buildSelectionRewriteUserMessage({
      sectionBody: "B",
      selectedText: "S",
      userPrompt: "用 @search_wiki AI.Talk 的资料改写",
    });
    expect(msg).toContain("@search_wiki");
    expect(msg).toContain("@search_raw");
    expect(msg).toMatch(/优先调用对应工具/);
  });

  it("ends with the plain-output instruction", () => {
    const msg = buildSelectionRewriteUserMessage({
      sectionBody: "B",
      selectedText: "S",
      userPrompt: "p",
    });
    expect(msg).toMatch(/仅输出改写后的新文本/);
  });
});

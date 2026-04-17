import { describe, it, expect } from "vitest";
import { splitByIndex, type IndexEntry } from "../src/components/wiki/autoLink";

const idx: IndexEntry[] = [
  { path: "entities/阶跃星辰.md", title: "阶跃星辰", aliases: ["StepFun"] },
  { path: "entities/StepClaw.md", title: "StepClaw", aliases: ["阶跃龙虾"] },
];

describe("splitByIndex", () => {
  it("splits text around matched entity names", () => {
    const segments = splitByIndex("阶跃星辰发布了 StepClaw 产品", idx, "entities/anywhere.md");
    expect(segments).toEqual([
      { kind: "link", text: "阶跃星辰", path: "entities/阶跃星辰.md" },
      { kind: "text", text: "发布了 " },
      { kind: "link", text: "StepClaw", path: "entities/StepClaw.md" },
      { kind: "text", text: " 产品" },
    ]);
  });

  it("prefers longer matches first", () => {
    const idx2: IndexEntry[] = [
      { path: "concepts/AI.md", title: "AI", aliases: [] },
      { path: "concepts/AIAgent.md", title: "AIAgent", aliases: [] },
    ];
    const segs = splitByIndex("AIAgent 和 AI 的区别", idx2, "x.md");
    expect(segs[0]).toEqual({ kind: "link", text: "AIAgent", path: "concepts/AIAgent.md" });
    expect(segs.some((s) => s.kind === "link" && s.text === "AI")).toBe(true);
  });

  it("does not self-link the current page", () => {
    const segs = splitByIndex("阶跃星辰和别的公司", idx, "entities/阶跃星辰.md");
    expect(segs).toEqual([{ kind: "text", text: "阶跃星辰和别的公司" }]);
  });

  it("matches aliases", () => {
    const segs = splitByIndex("StepFun 出品", idx, "x.md");
    expect(segs[0]).toEqual({ kind: "link", text: "StepFun", path: "entities/阶跃星辰.md" });
  });

  it("returns single text when no matches", () => {
    const segs = splitByIndex("没有匹配的内容", idx, "x.md");
    expect(segs).toEqual([{ kind: "text", text: "没有匹配的内容" }]);
  });

  it("returns empty array for empty text", () => {
    expect(splitByIndex("", idx, "x.md")).toEqual([]);
  });
});

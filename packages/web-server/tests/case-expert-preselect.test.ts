import { describe, it, expect } from "vitest";
import { computeCasePreselect } from "../src/services/case-expert-preselect.js";

describe("computeCasePreselect", () => {
  it("union of mission experts and top3 creativity", () => {
    const all = [
      { name: "A", active: true, creativity_score: 9 } as any,
      { name: "B", active: true, creativity_score: 8 } as any,
      { name: "C", active: true, creativity_score: 7 } as any,
      { name: "D", active: true, creativity_score: 6 } as any,
      { name: "E", active: true, creativity_score: 5 } as any,
    ];
    const picked = computeCasePreselect(all, ["D", "E"]);
    expect(picked.sort()).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("caps at 5", () => {
    const all = Array.from({ length: 10 }).map((_, i) => ({
      name: `X${i}`, active: true, creativity_score: 10 - i,
    })) as any;
    const picked = computeCasePreselect(all, ["X5", "X6", "X7", "X8"]);
    expect(picked.length).toBeLessThanOrEqual(5);
  });

  it("includes top3 when mission is empty", () => {
    const all = [
      { name: "A", creativity_score: 9 } as any,
      { name: "B", creativity_score: 8 } as any,
      { name: "C", creativity_score: 7 } as any,
    ];
    expect(computeCasePreselect(all, []).sort()).toEqual(["A", "B", "C"]);
  });
});

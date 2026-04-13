import { describe, it, expect } from "vitest";
import { buildSelectedCasesMd } from "../src/services/selected-cases-writer.js";

describe("buildSelectedCasesMd", () => {
  it("emits frontmatter + selected cases + checklist", () => {
    const candidatesMd = `---
type: case_plan_candidates
---

# Case 1 — A
proposed_by: X

body A

# Case 2 — B
proposed_by: Y

body B

# Case 3 — C
proposed_by: Z

body C
`;
    const md = buildSelectedCasesMd({
      candidatesMd,
      selectedIndices: [1, 3],
      projectId: "p1",
      missionRef: "mission/selected.md",
      overviewRef: "context/product-overview.md",
    });
    expect(md).toContain("type: case_plan");
    expect(md).toContain("selected_indices: [1, 3]");
    expect(md).toContain("selected_count: 2");
    expect(md).toContain("# Case 1 — A");
    expect(md).toContain("# Case 3 — C");
    expect(md).not.toContain("# Case 2 — B");
    expect(md).toContain("# 实测引导");
    expect(md).toContain("- [ ]");
  });
});

import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { CaseSelectedGuide } from "../../src/components/right/CaseSelectedGuide";

vi.mock("../../src/api/client", () => ({
  getSelectedCases: vi.fn(async () => `---
type: case_plan
selected_count: 2
---

# 已选 Cases

## Case 1 — A
body

# 实测引导（给人看的 checklist）

### 准备
- [ ] 录屏工具
- [ ] 登录

### Case 1 执行
- [ ] 步骤 1
`),
}));

describe("CaseSelectedGuide", () => {
  it("renders selected guide md", async () => {
    render(<CaseSelectedGuide projectId="p1" />);
    await waitFor(() => screen.getByText(/Case Plan 已批准/));
    expect(screen.getByText(/去跑真实测/)).toBeInTheDocument();
  });

  it("SP-04 evidence button is disabled", async () => {
    render(<CaseSelectedGuide projectId="p1" />);
    await waitFor(() => screen.getByText(/Case Plan 已批准/));
    const btn = screen.getByRole("button", { name: /Evidence/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});

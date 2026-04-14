import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/model-adapter.js", () => ({
  invokeAgent: vi.fn(),
}));

import { invokeAgent } from "../src/model-adapter.js";
import { WriterPracticeAgent } from "../src/roles/writer-practice-agent.js";

describe("WriterPracticeAgent", () => {
  beforeEach(() => {
    (invokeAgent as any).mockReset();
    (invokeAgent as any).mockReturnValue({
      text: "## Case 1 — 文档对话\n实测下来…",
      meta: { cli: "claude", model: "sonnet", durationMs: 2000 },
    });
  });

  it("passes screenshots as images for vision + includes notes/caseDescription", async () => {
    const agent = new WriterPracticeAgent({ cli: "claude", model: "sonnet" });
    const out = await agent.write({
      caseId: "case-01",
      caseName: "文档对话",
      caseDescription: "# Case 1 — 文档对话\n用户问A，期望B",
      notesBody: "实测 30 min，核心观察：响应快但偶尔幻觉",
      notesFrontmatter: { duration_min: 30, observations: [{ point: "响应快", severity: "positive" }] },
      screenshotPaths: ["/tmp/s1.png", "/tmp/s2.png"],
      referenceAccountsKb: [{ id: "数字生命卡兹克", text: "【实测段落样本】" }],
    });
    expect(out.text).toContain("Case 1");
    const call = (invokeAgent as any).mock.calls[0]![0];
    expect(call.agentKey).toBe("writer.practice");
    expect(call.images).toEqual(["/tmp/s1.png", "/tmp/s2.png"]);
    expect(call.userMessage).toContain("case-01");
    expect(call.userMessage).toContain("文档对话");
    expect(call.userMessage).toContain("用户问A");
    expect(call.userMessage).toContain("响应快但偶尔幻觉");
    expect(call.userMessage).toContain("数字生命卡兹克");
  });

  it("handles empty screenshots without vision attachments", async () => {
    const agent = new WriterPracticeAgent({ cli: "claude", model: "sonnet" });
    await agent.write({
      caseId: "case-02",
      caseName: "n",
      caseDescription: "d",
      notesBody: "b",
      notesFrontmatter: {},
      screenshotPaths: [],
      referenceAccountsKb: [],
    });
    const call = (invokeAgent as any).mock.calls[0]![0];
    expect(call.images).toEqual([]);
  });
});

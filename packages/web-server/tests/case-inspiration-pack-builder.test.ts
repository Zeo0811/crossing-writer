import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildInspirationPack } from "../src/services/case-inspiration-pack-builder.js";

const mockSearch = vi.fn();
vi.mock("../src/services/crossing-kb-search.js", () => ({
  searchRefs: (...args: any[]) => mockSearch(...args),
}));

describe("buildInspirationPack", () => {
  it("extracts prompts and steps from refs", async () => {
    const vault = mkdtempSync(join(tmpdir(), "insp-"));
    const refDir = join(vault, "10_refs/卡兹克/2026");
    mkdirSync(refDir, { recursive: true });
    writeFileSync(join(refDir, "2026-01-01_AI视频.md"), `---
title: 实测 AI 视频
account: 数字生命卡兹克
date: 2026-01-01
---
# 背景
我们测试了 C1 模型。

## 提示词如下：
\`\`\`
古代山门宗派入口，两名修士对峙
\`\`\`

## 测试步骤
1. 准备九宫格图
2. 选 C1 模型
3. 点生成
`, "utf-8");

    mockSearch.mockResolvedValue([{
      mdPath: "10_refs/卡兹克/2026/2026-01-01_AI视频.md",
      title: "实测 AI 视频",
      account: "数字生命卡兹克",
      date: "2026-01-01",
    }]);

    const pack = await buildInspirationPack({
      vaultPath: vault,
      sqlitePath: "/fake",
      queries: ["AI 视频 实测"],
      maxSources: 10,
    });
    expect(pack).toContain("古代山门宗派入口");
    expect(pack).toContain("准备九宫格图");
    expect(pack).toContain("数字生命卡兹克");
    expect(pack).toContain("type: case_inspiration_pack");
  });

  it("falls back to summary when no prompt/steps found", async () => {
    const vault = mkdtempSync(join(tmpdir(), "insp-"));
    const refDir = join(vault, "10_refs/黄叔/2026");
    mkdirSync(refDir, { recursive: true });
    writeFileSync(join(refDir, "x.md"), `---
title: 工具测评
account: 黄叔
---
# 纯文本内容，没 code block，没步骤列表
只是段落描述了一下产品印象。
`, "utf-8");

    mockSearch.mockResolvedValue([{
      mdPath: "10_refs/黄叔/2026/x.md",
      title: "工具测评", account: "黄叔", date: "2026",
    }]);
    const pack = await buildInspirationPack({
      vaultPath: vault, sqlitePath: "/fake",
      queries: ["工具"], maxSources: 10,
    });
    expect(pack).toContain("工具测评");
    expect(pack).toContain("纯文本内容");
  });
});

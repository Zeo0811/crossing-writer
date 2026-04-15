import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import Database from "better-sqlite3";

vi.mock("@crossing/agents", () => ({
  stripAgentPreamble: (s: string) => s,
  StyleDistillerStructureAgent: vi.fn().mockImplementation(() => ({
    distill: vi.fn().mockResolvedValue({
      text: "一、核心定位\n十字路口定位是AI产品观察。\n二、开头写法\n数据派开头。\n三、结构骨架\n开头-cases-结尾。\n四、实测段落写法\n每case 一个小节。\n五、语气 tone\n冷静克制。\n六、行业观察段 / 收束段\n偏留白。\n七、视觉/排版元素\n加粗判断句。\n八、禁区\n不用感叹号。\n九、给 Writer Agent 的一句话 system prompt 提炼\n写得像十字路口。\n十、待补\n",
      meta: { cli: "claude", model: "opus", durationMs: 100 },
    }),
  })),
  StyleDistillerSnippetsAgent: vi.fn().mockImplementation(() => ({
    harvest: vi.fn().mockResolvedValue({
      candidates: [
        { tag: "opening.data", from: "a0", excerpt: "据统计，25亿次。", position_ratio: 0.02, length: 10 },
        { tag: "bold.judgment", from: "a1", excerpt: "不是X，而是Y。", position_ratio: 0.5, length: 8 },
        { tag: "closing.blank", from: "a2", excerpt: "下半场开始了。", position_ratio: 0.97, length: 7 },
      ],
      meta: { cli: "claude", model: "opus", durationMs: 100 },
    }),
  })),
  StyleDistillerComposerAgent: vi.fn().mockImplementation(() => ({
    compose: vi.fn().mockImplementation(async (input: any) => ({
      kbMd: [
        "---",
        "type: style_expert",
        `account: ${input.account}`,
        "version: v2",
        `sample_size_requested: ${input.sampleSizeRequested}`,
        `sample_size_actual: ${input.sampleSizeActual}`,
        `distilled_at: ${input.distilledAt}`,
        "---",
        `# ${input.account} 风格卡 v2`,
        "## 量化指标表",
        "| 指标 | 中位数 |",
        "|---|---|",
        "| 整篇字数 | 3200 |",
        "## 片段库",
        "```yaml",
        input.snippetsYaml,
        "```",
      ].join("\n"),
      meta: { cli: "claude", model: "opus", durationMs: 100 },
    })),
  })),
}));

import { registerKbStylePanelsRoutes } from "../src/routes/kb-style-panels.js";

function seedVault() {
  const vault = mkdtempSync(join(tmpdir(), "sp06-e2e-"));
  mkdirSync(join(vault, "08_experts", "style-panel"), { recursive: true });
  mkdirSync(join(vault, ".index"), { recursive: true });
  const sqlitePath = join(vault, ".index", "refs.sqlite");
  const db = new Database(sqlitePath);
  db.exec(`CREATE TABLE ref_articles (id TEXT PRIMARY KEY, account TEXT, title TEXT, author TEXT, published_at TEXT, url TEXT, summary TEXT, md_path TEXT, topics_core_json TEXT, topics_fine_json TEXT, body_plain TEXT, word_count INT, is_original INT)`);
  const ins = db.prepare(`INSERT INTO ref_articles VALUES (@id,'赛博禅心','t','',@p,'','','','[]','[]',@b,@wc,1)`);
  for (let i = 0; i < 60; i += 1) {
    const m = String((i % 12) + 1).padStart(2, "0");
    ins.run({ id: `a${i}`, p: `2025-${m}-01`, b: `正文${i} `.repeat(200), wc: 1000 + i * 20 });
  }
  db.close();
  return { vault, sqlitePath };
}

describe("SP-06 e2e: POST /distill full pipeline", () => {
  it("writes .distill/<account>/* + kb.md with v2 frontmatter", async () => {
    const { vault, sqlitePath } = seedVault();
    const app = Fastify();
    registerKbStylePanelsRoutes(app, { vaultPath: vault, sqlitePath });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/kb/style-panels/赛博禅心/distill",
      payload: { sample_size: 30 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("event: distill.all_completed");

    const distillDir = join(vault, ".distill", "赛博禅心");
    expect(existsSync(join(distillDir, "quant.json"))).toBe(true);
    expect(existsSync(join(distillDir, "structure.md"))).toBe(true);
    expect(existsSync(join(distillDir, "snippets.yaml"))).toBe(true);
    expect(existsSync(join(distillDir, "distilled_at.txt"))).toBe(true);

    const kbPath = join(vault, "08_experts", "style-panel", "赛博禅心_kb.md");
    expect(existsSync(kbPath)).toBe(true);
    const kb = readFileSync(kbPath, "utf-8");
    expect(kb.startsWith("---\n")).toBe(true);
    expect(kb).toContain("type: style_expert");
    expect(kb).toContain("account: 赛博禅心");
    expect(kb).toContain("version: v2");
    expect(kb).toContain("sample_size_actual: 30");
    expect(kb).toContain("# 赛博禅心 风格卡 v2");
    expect(kb).toContain("量化指标表");
    expect(kb).toContain("片段库");
    expect(kb).toContain("opening.data");

    const quant = JSON.parse(readFileSync(join(distillDir, "quant.json"), "utf-8"));
    expect(quant.account).toBe("赛博禅心");
    expect(quant.article_count).toBe(30);
    expect(quant.word_count.median).toBeGreaterThan(0);
  });
});

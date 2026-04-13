import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/services/project-store.js";
import { ImageStore } from "../src/services/image-store.js";
import { analyzeOverview } from "../src/services/overview-analyzer-service.js";

vi.mock("@crossing/agents", () => ({
  ProductOverviewAgent: vi.fn().mockImplementation(() => ({
    analyze: async () => ({
      text: "---\ntype: product_overview\nproduct_name: X\n---\n# 产品概览\n正文",
      meta: { cli: "claude", model: "opus", durationMs: 5000 },
    }),
  })),
  resolveAgent: vi.fn(() => ({ cli: "claude", model: "opus" })),
}));

describe("analyzeOverview", () => {
  it("writes product-overview.md and appends events", async () => {
    const vault = mkdtempSync(join(tmpdir(), "ov-"));
    const projectsDir = join(vault, "07_projects");
    const store = new ProjectStore(projectsDir);
    const imageStore = new ImageStore(projectsDir);
    const p = await store.create({ name: "T" });
    await imageStore.save({
      projectId: p.id, filename: "a.png",
      buffer: Buffer.from("x"), source: "brief",
    });

    const projectDir = join(projectsDir, p.id);
    mkdirSync(join(projectDir, "mission"), { recursive: true });
    writeFileSync(join(projectDir, "mission/selected.md"), "Mission body", "utf-8");

    await analyzeOverview({
      projectId: p.id, projectsDir, store, imageStore,
      productUrls: ["https://x.com"],
      userDescription: "desc",
      agents: {}, defaultCli: "claude", fallbackCli: "codex",
    } as any);

    const overviewPath = join(projectDir, "context/product-overview.md");
    expect(existsSync(overviewPath)).toBe(true);
    expect(readFileSync(overviewPath, "utf-8")).toContain("type: product_overview");

    const events = readFileSync(join(projectDir, "events.jsonl"), "utf-8");
    expect(events).toContain("overview.started");
    expect(events).toContain("overview.completed");
    expect(events).toContain('"cli":"claude"');

    const updated = await store.get(p.id);
    expect(updated?.status).toBe("overview_ready");
    expect((updated as any)?.overview?.overview_path).toBe("context/product-overview.md");
  });

  it("transitions to overview_failed when agent throws", async () => {
    const { ProductOverviewAgent } = await import("@crossing/agents") as any;
    ProductOverviewAgent.mockImplementationOnce(() => ({
      analyze: async () => { throw new Error("vision unavailable"); },
    }));
    const vault = mkdtempSync(join(tmpdir(), "ov-"));
    const projectsDir = join(vault, "07_projects");
    const store = new ProjectStore(projectsDir);
    const imageStore = new ImageStore(projectsDir);
    const p = await store.create({ name: "T" });
    await imageStore.save({
      projectId: p.id, filename: "a.png",
      buffer: Buffer.from("x"), source: "brief",
    });
    mkdirSync(join(projectsDir, p.id, "mission"), { recursive: true });
    writeFileSync(join(projectsDir, p.id, "mission/selected.md"), "m", "utf-8");

    await expect(analyzeOverview({
      projectId: p.id, projectsDir, store, imageStore,
      productUrls: [], userDescription: "",
      agents: {}, defaultCli: "claude", fallbackCli: "codex",
    } as any)).rejects.toThrow(/vision unavailable/);

    const updated = await store.get(p.id);
    expect(updated?.status).toBe("overview_failed");
  });
});

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { ProductOverviewAgent, resolveAgent, stripAgentPreamble } from "@crossing/agents";
import type { ProjectStore } from "./project-store.js";
import type { ImageStore } from "./image-store.js";
import { appendEvent } from "./event-log.js";

export interface AnalyzeOverviewOpts {
  projectId: string;
  projectsDir: string;
  store: ProjectStore;
  imageStore: ImageStore;
  productUrls: string[];
  userDescription?: string;
  vaultPath?: string;
  sqlitePath?: string;
  agents: Record<string, unknown>;
  defaultCli: "claude" | "codex";
  fallbackCli: "claude" | "codex";
}

export async function analyzeOverview(opts: AnalyzeOverviewOpts): Promise<string> {
  const projectDir = join(opts.projectsDir, opts.projectId);
  const resolved = resolveAgent(
    { vaultPath: opts.vaultPath ?? "", sqlitePath: opts.sqlitePath ?? "",
      modelAdapter: { defaultCli: opts.defaultCli, fallbackCli: opts.fallbackCli },
      agents: opts.agents },
    "product_overview",
  );

  await opts.store.update(opts.projectId, { status: "overview_analyzing" });
  await appendEvent(projectDir, {
    type: "overview.started",
    agent: "product_overview",
    cli: resolved.cli,
    model: resolved.model ?? null,
  });

  try {
    const images = await opts.imageStore.list(opts.projectId);
    const briefImages = images.filter((i) => i.source === "brief").map((i) => i.absPath);
    const screenshots = images.filter((i) => i.source === "screenshot").map((i) => i.absPath);

    let productFetchedMd = "";
    try {
      productFetchedMd = await readFile(join(projectDir, "context/product-fetched.md"), "utf-8");
    } catch {}
    let missionSummary = "";
    try {
      const m = await readFile(join(projectDir, "mission/selected.md"), "utf-8");
      missionSummary = m.slice(0, 800);
    } catch {}

    const agent = new ProductOverviewAgent({
      cli: resolved.cli as "claude" | "codex",
      model: resolved.model,
    });
    const started = Date.now();
    const result = await agent.analyze({
      briefImages, screenshots, productFetchedMd,
      userDescription: opts.userDescription ?? "",
      missionSummary,
    });
    const durationMs = Date.now() - started;

    const outPath = join(projectDir, "context/product-overview.md");
    await mkdir(join(projectDir, "context"), { recursive: true });
    await writeFile(outPath, stripAgentPreamble(result.text), "utf-8");

    await opts.store.update(opts.projectId, {
      status: "overview_ready",
      overview: {
        images_dir: "context/images",
        overview_path: "context/product-overview.md",
        generated_at: new Date().toISOString(),
        human_edited: false,
      },
    });

    await appendEvent(projectDir, {
      type: "overview.completed",
      agent: "product_overview",
      cli: resolved.cli,
      model: resolved.model ?? null,
      output: "context/product-overview.md",
      durationMs,
    });
    return outPath;
  } catch (e) {
    await opts.store.update(opts.projectId, { status: "overview_failed" });
    await appendEvent(projectDir, {
      type: "overview.failed",
      agent: "product_overview",
      cli: resolved.cli,
      model: resolved.model ?? null,
      error: String(e),
    });
    throw e;
  }
}

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BriefAnalyst, resolveAgent, type AgentConfig } from "@crossing/agents";
import type { ProjectStore } from "./project-store.js";
import { appendEvent } from "./event-log.js";

export interface AnalyzeBriefOpts {
  projectId: string;
  projectsDir: string;
  store: ProjectStore;
  cli: "claude" | "codex";   // 保留用于 Fastify route 向后兼容，可作为默认
  agents: Record<string, AgentConfig>;
  defaultCli: "claude" | "codex";
  fallbackCli: "claude" | "codex";
}

export async function analyzeBrief(opts: AnalyzeBriefOpts): Promise<void> {
  const { projectId, projectsDir, store, agents, defaultCli, fallbackCli } = opts;
  const project = await store.get(projectId);
  if (!project || !project.brief) throw new Error("no brief to analyze");

  const projectDir = join(projectsDir, projectId);
  const fromStatus = project.status;
  await appendEvent(projectDir, {
    type: "state_changed",
    from: fromStatus,
    to: "brief_analyzing",
  });
  await store.update(projectId, { status: "brief_analyzing" });
  await appendEvent(projectDir, { type: "agent.started", agent: "brief_analyst" });

  try {
    const briefBody = await readFile(join(projectDir, project.brief.md_path), "utf-8");
    const productInfo = JSON.stringify(project.product_info ?? {}, null, 2);
    const resolved = resolveAgent(
      {
        vaultPath: "", sqlitePath: "",
        modelAdapter: { defaultCli, fallbackCli },
        agents,
      },
      "brief_analyst",
    );
    const analyst = new BriefAnalyst({ cli: resolved.cli, model: resolved.model });
    const result = analyst.analyze({ projectId, briefBody, productInfo });

    const summaryPath = "brief/brief-summary.md";
    await writeFile(join(projectDir, summaryPath), result.text, "utf-8");

    await store.update(projectId, {
      status: "brief_ready",
      brief: { ...project.brief, summary_path: summaryPath },
    });
    await appendEvent(projectDir, {
      type: "agent.completed",
      agent: "brief_analyst",
      output: summaryPath,
    });
    await appendEvent(projectDir, {
      type: "state_changed",
      from: "brief_analyzing",
      to: "brief_ready",
    });
  } catch (e: any) {
    await appendEvent(projectDir, {
      type: "agent.failed",
      agent: "brief_analyst",
      error: String(e),
    });
    await store.update(projectId, { status: "brief_uploaded" });
    throw e;
  }
}

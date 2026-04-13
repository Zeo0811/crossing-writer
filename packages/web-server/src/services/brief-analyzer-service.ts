import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BriefAnalyst } from "@crossing/agents";
import type { ProjectStore } from "./project-store.js";
import { appendEvent } from "./event-log.js";

export interface AnalyzeBriefOpts {
  projectId: string;
  projectsDir: string;
  store: ProjectStore;
  cli: "claude" | "codex";
  model?: string;
}

export async function analyzeBrief(opts: AnalyzeBriefOpts): Promise<void> {
  const { projectId, projectsDir, store, cli, model } = opts;
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
    const analyst = new BriefAnalyst({ cli, model });
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

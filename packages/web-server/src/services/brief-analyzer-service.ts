import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BriefAnalyst, resolveAgent, stripAgentPreamble, type AgentConfig } from "@crossing/agents";
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
  const resolved = resolveAgent(
    {
      vaultPath: "", sqlitePath: "",
      modelAdapter: { defaultCli, fallbackCli },
      agents,
    },
    "brief_analyst",
  );
  const fromStatus = project.status;
  await appendEvent(projectDir, {
    type: "state_changed",
    from: fromStatus,
    to: "brief_analyzing",
  });
  await store.update(projectId, { status: "brief_analyzing" });
  await appendEvent(projectDir, {
    type: "agent.started",
    agent: "brief_analyst",
    cli: resolved.cli,
    model: resolved.model ?? null,
  });

  try {
    let briefBody = await readFile(join(projectDir, project.brief.md_path), "utf-8");
    const MAX_BRIEF_CHARS = 40_000;
    if (briefBody.length > MAX_BRIEF_CHARS) {
      await appendEvent(projectDir, {
        type: "agent.warning",
        agent: "brief_analyst",
        message: `brief 过长 (${briefBody.length} chars)，已截断到前 ${MAX_BRIEF_CHARS} 字符。建议检查 docx 是否包含大图`,
      });
      briefBody = briefBody.slice(0, MAX_BRIEF_CHARS) + "\n\n…（已截断）";
    }
    const productInfo = JSON.stringify(project.product_info ?? {}, null, 2);

    // Resolve relative image/attachment refs in brief.md to absolute paths.
    // Brief.md lives under brief/, so refs like ![](images/xxx.png) resolve under brief/.
    const briefDir = join(projectDir, "brief");
    const imgPaths = new Set<string>();
    const imgRe = /!\[[^\]]*\]\(([^)]+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = imgRe.exec(briefBody)) !== null) {
      const ref = m[1]!;
      if (ref.startsWith("http://") || ref.startsWith("https://")) continue;
      if (ref.startsWith("/")) { imgPaths.add(ref); continue; }
      imgPaths.add(join(briefDir, ref));
    }

    const analyst = new BriefAnalyst({ cli: resolved.cli, model: resolved.model });
    const result = await analyst.analyze({
      projectId,
      briefBody,
      productInfo,
      images: Array.from(imgPaths),
      addDirs: [briefDir],
    });

    const summaryPath = "brief/brief-summary.md";
    await writeFile(join(projectDir, summaryPath), stripAgentPreamble(result.text), "utf-8");

    await store.update(projectId, {
      status: "brief_ready",
      brief: { ...project.brief, summary_path: summaryPath },
    });
    await appendEvent(projectDir, {
      type: "agent.completed",
      agent: "brief_analyst",
      output: summaryPath,
      cli: resolved.cli,
      model: resolved.model ?? null,
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
      cli: resolved.cli,
      model: resolved.model ?? null,
    });
    await store.update(projectId, { status: "brief_uploaded" });
    throw e;
  }
}

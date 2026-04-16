import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Coordinator, resolveAgent, stripAgentPreamble, type AgentConfig } from "@crossing/agents";
import type { ProjectStore } from "./project-store.js";
import { appendEvent } from "./event-log.js";

export interface RunRefineOpts {
  projectId: string;
  feedback: string;
  store: ProjectStore;
  projectsDir: string;
  agents: Record<string, AgentConfig>;
  defaultCli: "claude" | "codex";
  fallbackCli: "claude" | "codex";
}

export async function runMissionRefine(opts: RunRefineOpts): Promise<{ round: number; path: string }> {
  const { projectId, feedback, store, projectsDir } = opts;
  const project = await store.get(projectId);
  if (!project) throw new Error("project not found");
  if (!project.mission?.selected_path) throw new Error("no selected mission to refine");

  const projectDir = join(projectsDir, projectId);
  const refinesDir = join(projectDir, "mission/refines");
  await mkdir(refinesDir, { recursive: true });

  const existing = (await readdir(refinesDir).catch(() => [])).filter((f) => /^round-\d+\.md$/.test(f));
  const nextRound = existing.length + 1;

  let currentMission: string;
  if (existing.length > 0) {
    const lastFile = `round-${existing.length}.md`;
    currentMission = await readFile(join(refinesDir, lastFile), "utf-8");
  } else {
    currentMission = await readFile(join(projectDir, project.mission.selected_path), "utf-8");
  }

  const historyParts: string[] = [];
  for (let i = 1; i <= existing.length; i++) {
    const p = join(refinesDir, `round-${i}.md`);
    try {
      const t = await readFile(p, "utf-8");
      historyParts.push(`## round-${i}\n\n${t}`);
    } catch { /* skip */ }
  }
  const refineHistory = historyParts.join("\n\n---\n\n");

  const resolved = resolveAgent(
    { vaultPath: "", sqlitePath: "", modelAdapter: { defaultCli: opts.defaultCli, fallbackCli: opts.fallbackCli }, agents: opts.agents },
    "coordinator",
  );

  const fromStatus = project.status;
  await store.update(projectId, { status: "mission_refining" });
  await appendEvent(projectDir, { type: "state_changed", from: fromStatus, to: "mission_refining" });
  await appendEvent(projectDir, {
    type: "mission.refine_requested",
    round: nextRound,
    feedback: feedback.slice(0, 500),
    cli: resolved.cli,
    model: resolved.model ?? null,
  });

  const startedMs = Date.now();
  const coord = new Coordinator({ cli: resolved.cli, model: resolved.model });
  const out = await coord.refine({
    projectId,
    currentMission,
    userFeedback: feedback,
    refineHistory,
  });
  const refinePath = `mission/refines/round-${nextRound}.md`;
  const feedbackPath = `mission/refines/round-${nextRound}.feedback.txt`;
  await writeFile(join(projectDir, refinePath), stripAgentPreamble(out.text), "utf-8");
  await writeFile(join(projectDir, feedbackPath), feedback, "utf-8");

  await store.update(projectId, { status: "mission_review" });
  await appendEvent(projectDir, {
    type: "mission.refine_completed",
    round: nextRound,
    output_path: refinePath,
    durationMs: Date.now() - startedMs,
  });
  await appendEvent(projectDir, { type: "state_changed", from: "mission_refining", to: "mission_review" });

  return { round: nextRound, path: refinePath };
}

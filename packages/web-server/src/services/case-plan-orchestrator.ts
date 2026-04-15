import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CasePlannerExpert, CaseCoordinator, runCaseExpert, resolveAgent,
  type CaseToolCall,
} from "@crossing/agents";
import type { ProjectStore } from "./project-store.js";
import { appendEvent } from "./event-log.js";
import { buildInspirationPack } from "./case-inspiration-pack-builder.js";
import { searchRefs } from "./crossing-kb-search.js";
import { collectProjectImages } from "./brief-images.js";

export interface RunCasePlanOpts {
  projectId: string;
  projectsDir: string;
  store: ProjectStore;
  vaultPath: string;
  sqlitePath: string;
  experts: string[];
  expertKbs: Record<string, string>;
  agents: Record<string, unknown>;
  defaultCli: "claude" | "codex";
  fallbackCli: "claude" | "codex";
}

export async function runCasePlan(opts: RunCasePlanOpts): Promise<string> {
  const projectDir = join(opts.projectsDir, opts.projectId);
  await opts.store.update(opts.projectId, { status: "case_planning_running" });

  const missionSummary = await readFile(join(projectDir, "mission/selected.md"), "utf-8");
  const productOverview = await readFile(join(projectDir, "context/product-overview.md"), "utf-8");
  const { images: projectImages, addDirs: projectAddDirs } = await collectProjectImages(projectDir);
  const inspirationPack = await buildInspirationPack({
    vaultPath: opts.vaultPath,
    sqlitePath: opts.sqlitePath,
    queries: extractQueries(missionSummary, productOverview),
    maxSources: 15,
  });
  await mkdir(join(projectDir, "context"), { recursive: true });
  await writeFile(join(projectDir, "context/case-inspiration-pack.md"), inspirationPack, "utf-8");

  const round1Dir = join(projectDir, "mission/case-plan/round1");
  await mkdir(round1Dir, { recursive: true });

  const expertOutputs: Array<{ expert: string; text: string }> = [];

  try {
    await Promise.all(opts.experts.map(async (name) => {
      const resolved = resolveAgent(
        { vaultPath: opts.vaultPath, sqlitePath: opts.sqlitePath,
          modelAdapter: { defaultCli: opts.defaultCli, fallbackCli: opts.fallbackCli },
          agents: opts.agents },
        `case_expert.${name}`,
      );
      await appendEvent(projectDir, {
        type: "case_expert.round1_started",
        agent: `case_expert.${name}`,
        expert: name,
        cli: resolved.cli, model: resolved.model ?? null,
      });
      const expert = new CasePlannerExpert({
        name, cli: resolved.cli as any, model: resolved.model,
        kbMarkdown: opts.expertKbs[name] ?? "",
      });

      const result = await runCaseExpert(
        expert,
        { missionSummary, productOverview, inspirationPack, images: projectImages, addDirs: projectAddDirs },
        async (calls: CaseToolCall[]) => {
          for (const c of calls) {
            await appendEvent(projectDir, {
              type: "case_expert.tool_call",
              expert: name,
              command: c.command,
              query: c.query,
              account: c.account,
            });
          }
          const hits = await searchRefs(opts.sqlitePath, calls[0]?.query ?? "", calls[0]?.limit ?? 5);
          return hits.map((h) => `- ${h.title} — ${h.account} (${h.mdPath})`).join("\n");
        },
      );

      await writeFile(join(round1Dir, `${name}.md`), result.final.text, "utf-8");
      if (result.roundsUsed === 2) {
        await appendEvent(projectDir, {
          type: "case_expert.round2_completed",
          agent: `case_expert.${name}`, expert: name,
          cli: resolved.cli, model: resolved.model ?? null,
        });
      }
      await appendEvent(projectDir, {
        type: "case_expert.round1_completed",
        agent: `case_expert.${name}`, expert: name,
        cli: resolved.cli, model: resolved.model ?? null,
        rounds_used: result.roundsUsed,
      });
      expertOutputs.push({ expert: name, text: result.final.text });
    }));
  } catch (e) {
    await opts.store.update(opts.projectId, { status: "case_planning_failed" });
    await appendEvent(projectDir, { type: "case_expert.failed", error: String(e) });
    throw e;
  }

  await opts.store.update(opts.projectId, { status: "case_synthesizing" });
  const coordResolved = resolveAgent(
    { vaultPath: opts.vaultPath, sqlitePath: opts.sqlitePath,
      modelAdapter: { defaultCli: opts.defaultCli, fallbackCli: opts.fallbackCli },
      agents: opts.agents },
    "case_coordinator",
  );
  await appendEvent(projectDir, {
    type: "case_coordinator.synthesizing",
    agent: "case_coordinator",
    cli: coordResolved.cli, model: coordResolved.model ?? null,
  });

  const coord = new CaseCoordinator({
    cli: coordResolved.cli as any, model: coordResolved.model,
  });
  const synth = await coord.synthesize({
    expertOutputs, missionSummary, productOverview,
    images: projectImages, addDirs: projectAddDirs,
  });
  const candPath = join(projectDir, "mission/case-plan/candidates.md");
  await mkdir(join(projectDir, "mission/case-plan"), { recursive: true });
  await writeFile(candPath, synth.text, "utf-8");

  await appendEvent(projectDir, {
    type: "case_coordinator.done",
    agent: "case_coordinator",
    cli: coordResolved.cli, model: coordResolved.model ?? null,
    output: "mission/case-plan/candidates.md",
  });
  await opts.store.update(opts.projectId, {
    status: "awaiting_case_selection",
    case_plan: {
      experts_selected: opts.experts,
      candidates_path: "mission/case-plan/candidates.md",
      selected_path: null, selected_indices: null,
      selected_count: 0, approved_at: null,
    },
  });
  return candPath;
}

function extractQueries(mission: string, overview: string): string[] {
  const qs: string[] = [];
  const catMatch = overview.match(/product_category:\s*(.+)/);
  if (catMatch) qs.push(catMatch[1]!.trim() + " 实测");
  const nameMatch = overview.match(/product_name:\s*(.+)/);
  if (nameMatch) qs.push(nameMatch[1]!.trim());
  if (qs.length === 0) qs.push("AI 实测");
  return qs;
}

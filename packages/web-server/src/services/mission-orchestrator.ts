import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TopicExpert, Coordinator, resolveAgent, type AgentConfig } from "@crossing/agents";
import type { SearchCtx } from "@crossing/kb";
import type { ProjectStore } from "./project-store.js";
import type { ExpertRegistry } from "./expert-registry.js";
import { appendEvent } from "./event-log.js";
import { buildRefsPack } from "./refs-fetcher.js";

export interface RunMissionOpts {
  projectId: string;
  experts: string[];
  store: ProjectStore;
  registry: ExpertRegistry;
  projectsDir: string;
  cli: "claude" | "codex";    // 保留，兼容现有 routes
  agents: Record<string, AgentConfig>;
  defaultCli: "claude" | "codex";
  fallbackCli: "claude" | "codex";
  model?: string;
  searchCtx: SearchCtx;
}

function resolveFor(key: string, opts: RunMissionOpts) {
  const r = resolveAgent(
    {
      vaultPath: "", sqlitePath: "",
      modelAdapter: { defaultCli: opts.defaultCli, fallbackCli: opts.fallbackCli },
      agents: opts.agents,
    },
    key,
  );
  return r;
}

function bundle(entries: Array<{ name: string; text: string }>): string {
  return entries.map((e) => `# === ${e.name} ===\n\n${e.text}`).join("\n\n---\n\n");
}

function extractQueries(briefSummary: string): string[] {
  const queries: string[] = [];
  const match = (re: RegExp) => {
    const m = briefSummary.match(re);
    return m?.[1]?.trim();
  };
  const brand = match(/^brand:\s*(.+)$/m);
  const product = match(/^product:\s*(.+)$/m);
  const productCat = match(/^product_category:\s*(.+)$/m);
  if (brand && brand !== "null") queries.push(brand.replace(/^["']|["']$/g, ""));
  if (product && product !== "null") queries.push(product.replace(/^["']|["']$/g, ""));
  if (productCat && productCat !== "null") queries.push(productCat.replace(/^["']|["']$/g, ""));
  // key_messages 前两条
  const kmBlock = briefSummary.match(/key_messages:\n((?:\s*-\s*.+\n?){1,5})/);
  if (kmBlock) {
    const items = [...(kmBlock[1] ?? "").matchAll(/\s*-\s*"?(.+?)"?\s*$/gm)]
      .map((m) => m[1]!)
      .slice(0, 2);
    queries.push(...items);
  }
  return queries.filter((q) => q && q !== "null");
}

export async function runMission(opts: RunMissionOpts): Promise<void> {
  const { projectId, experts, store, registry, projectsDir, searchCtx } = opts;
  const project = await store.get(projectId);
  if (!project) throw new Error("project not found");
  if (!project.brief?.summary_path) throw new Error("brief summary missing");

  const projectDir = join(projectsDir, projectId);
  const runId = `run-${Date.now()}`;
  const briefSummary = await readFile(
    join(projectDir, project.brief.summary_path),
    "utf-8",
  );

  // Collect brief-attached images from brief.md + brief-summary.md so downstream
  // coordinator + topic-expert agents can read them via @-ref + --add-dir.
  const briefDir = join(projectDir, "brief");
  let briefBody = "";
  if (project.brief.md_path) {
    try {
      briefBody = await readFile(join(projectDir, project.brief.md_path), "utf-8");
    } catch {
      briefBody = "";
    }
  }
  const imgPaths = new Set<string>();
  const imgRe = /!\[[^\]]*\]\(([^)]+)\)/g;
  for (const src of [briefBody, briefSummary]) {
    let m: RegExpExecArray | null;
    while ((m = imgRe.exec(src)) !== null) {
      const ref = m[1]!;
      if (ref.startsWith("http://") || ref.startsWith("https://")) continue;
      if (ref.startsWith("/")) { imgPaths.add(ref); continue; }
      imgPaths.add(join(briefDir, ref));
    }
    imgRe.lastIndex = 0;
  }
  const briefImages = Array.from(imgPaths);
  const addDirs = [briefDir];

  // round1
  const fromStatus = project.status;
  await appendEvent(projectDir, { type: "state_changed", from: fromStatus, to: "round1_running" });
  await store.update(projectId, {
    status: "round1_running",
    experts_selected: experts,
    runs: [
      ...(project.runs ?? []),
      {
        id: runId,
        stage: "mission",
        started_at: new Date().toISOString(),
        ended_at: null,
        experts,
        status: "running",
      },
    ],
  });

  // refs pack
  const queries = extractQueries(briefSummary);
  const refsPack = buildRefsPack({
    ctx: searchCtx,
    queries: queries.length ? queries : ["AI"],
    limitPerQuery: 10,
    totalLimit: 30,
  });
  await mkdir(join(projectDir, "context"), { recursive: true });
  await writeFile(join(projectDir, "context/refs-pack.md"), refsPack, "utf-8");
  await appendEvent(projectDir, {
    type: "refs_pack.generated",
    queries,
    total: (refsPack.match(/^## \d+\./gm) ?? []).length,
  });

  // round1 parallel
  await mkdir(join(projectDir, "mission/round1"), { recursive: true });
  const round1Results: Array<{ name: string; text: string }> = [];
  await Promise.all(
    experts.map(async (name) => {
      const expertResolved = resolveFor(`topic_expert.${name}`, opts);
      await appendEvent(projectDir, {
        type: "expert.round1_started",
        expert: name,
        cli: expertResolved.cli,
        model: expertResolved.model ?? null,
      });
      const kbContent = registry.readKb("topic-panel", name);
      const entry = registry.listAll("topic-panel").find((e) => e.name === name)!;
      const agent = new TopicExpert({
        name,
        kbContent,
        kbSource: `08_experts/topic-panel/${entry.file}`,
        cli: expertResolved.cli,
        model: expertResolved.model,
      });
      const out = agent.round1({ projectId, runId, briefSummary, refsPack, images: briefImages, addDirs });
      await writeFile(join(projectDir, `mission/round1/${name}.md`), out.text, "utf-8");
      round1Results.push({ name, text: out.text });
      await appendEvent(projectDir, {
        type: "expert.round1_completed",
        expert: name,
        cli: expertResolved.cli,
        model: expertResolved.model ?? null,
      });
    }),
  );

  // coordinator synthesize
  await store.update(projectId, { status: "synthesizing" });
  await appendEvent(projectDir, {
    type: "state_changed",
    from: "round1_running",
    to: "synthesizing",
  });
  const coordResolved = resolveFor("coordinator", opts);
  await appendEvent(projectDir, {
    type: "coordinator.synthesizing",
    cli: coordResolved.cli,
    model: coordResolved.model ?? null,
  });
  const coord = new Coordinator({ cli: coordResolved.cli, model: coordResolved.model });
  const candidatesResult = coord.round1Synthesize({
    projectId,
    runId,
    briefSummary,
    refsPack,
    round1Bundle: bundle(round1Results),
    experts,
    images: briefImages,
    addDirs,
  });
  const candidatesPath = "mission/candidates.md";
  await writeFile(join(projectDir, candidatesPath), candidatesResult.text, "utf-8");
  await appendEvent(projectDir, {
    type: "coordinator.candidates_ready",
    output_path: candidatesPath,
    cli: coordResolved.cli,
    model: coordResolved.model ?? null,
  });

  // round2 parallel
  await store.update(projectId, { status: "round2_running" });
  await appendEvent(projectDir, {
    type: "state_changed",
    from: "synthesizing",
    to: "round2_running",
  });
  await mkdir(join(projectDir, "mission/round2"), { recursive: true });
  const round2Results: Array<{ name: string; text: string }> = [];
  await Promise.all(
    experts.map(async (name) => {
      const expertResolved = resolveFor(`topic_expert.${name}`, opts);
      await appendEvent(projectDir, {
        type: "expert.round2_started",
        expert: name,
        cli: expertResolved.cli,
        model: expertResolved.model ?? null,
      });
      const kbContent = registry.readKb("topic-panel", name);
      const entry = registry.listAll("topic-panel").find((e) => e.name === name)!;
      const agent = new TopicExpert({
        name,
        kbContent,
        kbSource: `08_experts/topic-panel/${entry.file}`,
        cli: expertResolved.cli,
        model: expertResolved.model,
      });
      const out = agent.round2({ projectId, runId, candidatesMd: candidatesResult.text, images: briefImages, addDirs });
      await writeFile(join(projectDir, `mission/round2/${name}.md`), out.text, "utf-8");
      round2Results.push({ name, text: out.text });
      await appendEvent(projectDir, {
        type: "expert.round2_completed",
        expert: name,
        cli: expertResolved.cli,
        model: expertResolved.model ?? null,
      });
    }),
  );

  // coordinator aggregate
  await appendEvent(projectDir, {
    type: "coordinator.aggregating",
    cli: coordResolved.cli,
    model: coordResolved.model ?? null,
  });
  const aggregated = coord.round2Aggregate({
    candidatesMd: candidatesResult.text,
    round2Bundle: bundle(round2Results),
    images: briefImages,
    addDirs,
  });
  await writeFile(join(projectDir, candidatesPath), aggregated.text, "utf-8");

  // done
  const final = await store.get(projectId);
  const runs = final!.runs ?? [];
  const lastRun = runs[runs.length - 1];
  await store.update(projectId, {
    status: "awaiting_mission_pick",
    mission: { ...final!.mission, candidates_path: candidatesPath },
    runs: lastRun
      ? [...runs.slice(0, -1), { ...lastRun, status: "completed", ended_at: new Date().toISOString() }]
      : runs,
  });
  await appendEvent(projectDir, {
    type: "state_changed",
    from: "round2_running",
    to: "awaiting_mission_pick",
  });
}

import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import {
  runSectionSlicer,
  StyleDistillerSnippetsAgent,
  StyleDistillerStructureAgent,
  StyleDistillerComposerAgent,
  type SectionSlice,
} from "@crossing/agents";
import { StylePanelStore } from "./style-panel-store.js";
import type { StylePanel, StylePanelFrontmatter } from "./style-panel-types.js";

export type RoleDistillRole = "opening" | "practice" | "closing";

export interface RoleDistillInput {
  account: string;
  role: RoleDistillRole;
}

export interface CliModel {
  cli: "claude" | "codex";
  model?: string;
}

export interface RoleDistillCtx {
  sqlitePath: string;
  vaultPath: string;
  limit?: number;
  concurrency?: number;
  cliModelPerStep?: {
    slicer?: CliModel;
    snippets?: CliModel;
    structure?: CliModel;
    composer?: CliModel;
  };
  onEvent?: (ev: RoleDistillEvent) => void;
}

export type RoleDistillEvent =
  | { phase: "started"; account: string; role: RoleDistillRole; run_id: string }
  | { phase: "slicer_progress"; processed: number; total: number }
  | { phase: "snippets_done"; count: number }
  | { phase: "structure_done" }
  | { phase: "composer_done"; panel_path: string }
  | { phase: "failed"; error: string };

export interface AllRolesDistillInput {
  account: string;
}

export interface AllRolesDistillCtx extends Omit<RoleDistillCtx, "onEvent"> {
  onEvent?: (ev: AllRolesDistillEvent) => void;
}

export type AllRolesDistillEvent =
  | { phase: "all.started"; account: string; run_id: string }
  | { phase: "slicer_progress"; processed: number; total: number }
  | { phase: "role_started"; role: RoleDistillRole }
  | {
      phase: "role_done";
      role: RoleDistillRole;
      panel_path: string;
      version: number;
    }
  | { phase: "role_failed"; role: RoleDistillRole; error: string }
  | {
      phase: "all.finished";
      results: Array<{
        role: RoleDistillRole;
        panel_path?: string;
        version?: number;
        error?: string;
      }>;
    };

export interface AllRolesDistillResult {
  results: Array<{
    role: RoleDistillRole;
    panelPath?: string;
    version?: number;
    error?: string;
  }>;
}

interface ArticleRow {
  id: string;
  body_plain: string;
  published_at: string | null;
}

function loadArticles(sqlitePath: string, account: string, limit: number): ArticleRow[] {
  if (!existsSync(sqlitePath)) return [];
  const db = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  try {
    return db
      .prepare(
        "SELECT id, body_plain, published_at FROM ref_articles WHERE account = @a ORDER BY published_at DESC LIMIT @lim",
      )
      .all({ a: account, lim: limit }) as ArticleRow[];
  } finally {
    db.close();
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  onEach?: (index: number) => void,
): Promise<(R | null)[]> {
  const results: (R | null)[] = new Array(items.length).fill(null);
  let cursor = 0;
  const runners: Promise<void>[] = [];
  for (let c = 0; c < Math.min(concurrency, items.length); c++) {
    runners.push(
      (async () => {
        while (true) {
          const i = cursor++;
          if (i >= items.length) break;
          try {
            results[i] = await worker(items[i]!, i);
          } catch {
            results[i] = null;
          }
          onEach?.(i);
        }
      })(),
    );
  }
  await Promise.all(runners);
  return results;
}

interface SlicerResult {
  articleId: string;
  body: string;
  slices: SectionSlice[];
}

async function runSlicerPhase(
  articles: ArticleRow[],
  concurrency: number,
  slicerOpts: CliModel,
  onProgress: (processed: number, total: number) => void,
): Promise<SlicerResult[]> {
  let processed = 0;
  onProgress(0, articles.length);
  const slicerResults = await mapWithConcurrency(
    articles,
    concurrency,
    async (a) => {
      const r = await runSectionSlicer(a.body_plain, slicerOpts);
      return { articleId: a.id, body: a.body_plain, slices: r.slices };
    },
    () => {
      processed += 1;
      onProgress(processed, articles.length);
    },
  );
  return slicerResults.filter((r): r is SlicerResult => r !== null);
}

function extractRoleCorpus(slicerResults: SlicerResult[], role: RoleDistillRole): string[] {
  const roleTexts: string[] = [];
  for (const r of slicerResults) {
    const slices: SectionSlice[] = r.slices.filter((s) => s.role === role);
    for (const s of slices) {
      const text = r.body.slice(s.start_char, s.end_char).trim();
      if (text.length > 0) roleTexts.push(text);
    }
  }
  return roleTexts;
}

async function runSnippetsStructureComposer(params: {
  account: string;
  role: RoleDistillRole;
  roleTexts: string[];
  articles: ArticleRow[];
  limit: number;
  run_id: string;
  start: number;
  vaultPath: string;
  cliModelPerStep?: RoleDistillCtx["cliModelPerStep"];
  onPhase?: (ev: RoleDistillEvent) => void;
}): Promise<{ panelPath: string; version: number }> {
  const {
    account,
    role,
    roleTexts,
    articles,
    limit,
    run_id,
    start,
    vaultPath,
    cliModelPerStep,
    onPhase,
  } = params;
  const corpus = roleTexts.join("\n\n---\n\n");

  const snippetsAgent = new StyleDistillerSnippetsAgent(
    cliModelPerStep?.snippets ?? { cli: "claude" },
  );
  const snippetsRes = await snippetsAgent.harvest({
    account,
    batchIndex: 0,
    totalBatches: 1,
    articles: [
      {
        id: "corpus",
        title: `${account} ${role} corpus`,
        published_at: new Date().toISOString().slice(0, 10),
        word_count: corpus.length,
        body_plain: corpus,
      },
    ],
  });
  onPhase?.({ phase: "snippets_done", count: snippetsRes.candidates.length });

  const structureAgent = new StyleDistillerStructureAgent(
    cliModelPerStep?.structure ?? { cli: "claude" },
  );
  const structureRes = await structureAgent.distill({
    account,
    samples: [
      {
        id: "corpus",
        title: `${account} ${role} corpus`,
        published_at: new Date().toISOString().slice(0, 10),
        word_count: corpus.length,
        body_plain: corpus,
      },
    ],
    quantSummary: `role=${role} slices=${roleTexts.length} source_articles=${articles.length}`,
  });
  onPhase?.({ phase: "structure_done" });

  const composerAgent = new StyleDistillerComposerAgent(
    cliModelPerStep?.composer ?? { cli: "claude" },
  );
  const dates = articles.map((a) => a.published_at ?? "").filter(Boolean).sort();
  const composeRes = await composerAgent.compose({
    account,
    sampleSizeRequested: limit,
    sampleSizeActual: articles.length,
    sourcePoolSize: articles.length,
    articleDateRange: {
      start: dates[0] ?? "",
      end: dates[dates.length - 1] ?? "",
    },
    distilledAt: new Date().toISOString(),
    stepClis: {
      structure: cliModelPerStep?.structure ?? { cli: "claude" },
      snippets: cliModelPerStep?.snippets ?? { cli: "claude" },
      composer: cliModelPerStep?.composer ?? { cli: "claude" },
    },
    deepReadIds: articles.slice(0, Math.min(3, articles.length)).map((a) => a.id),
    quantJson: JSON.stringify({
      role,
      source_articles: articles.length,
      role_slice_count: roleTexts.length,
    }),
    structureMd: structureRes.text,
    snippetsYaml: JSON.stringify(snippetsRes.candidates, null, 2),
  });

  const store = new StylePanelStore(vaultPath);
  const existing = store.list().filter(
    (p) => p.frontmatter.account === account && p.frontmatter.role === role,
  );
  const nextVersion =
    existing.length === 0 ? 1 : Math.max(...existing.map((p) => p.frontmatter.version)) + 1;

  const frontmatter: StylePanelFrontmatter = {
    account,
    role,
    version: nextVersion,
    status: "active",
    created_at: new Date().toISOString(),
    source_article_count: articles.length,
    slicer_run_id: run_id,
    composer_duration_ms: Date.now() - start,
  };
  const panel: StylePanel = { frontmatter, body: composeRes.kbMd, absPath: "" };
  const panelPath = store.write(panel);
  onPhase?.({ phase: "composer_done", panel_path: panelPath });

  return { panelPath, version: nextVersion };
}

export async function runRoleDistill(
  input: RoleDistillInput,
  ctx: RoleDistillCtx,
): Promise<{ panelPath: string; version: number }> {
  const emit = (ev: RoleDistillEvent) => ctx.onEvent?.(ev);
  const run_id = `rd-${Date.now()}`;
  const start = Date.now();
  emit({ phase: "started", account: input.account, role: input.role, run_id });

  try {
    const limit = ctx.limit ?? 50;
    const concurrency = ctx.concurrency ?? 5;
    const articles = loadArticles(ctx.sqlitePath, input.account, limit);
    if (articles.length === 0) {
      throw new Error(`no articles found for account: ${input.account}`);
    }

    const slicerResults = await runSlicerPhase(
      articles,
      concurrency,
      ctx.cliModelPerStep?.slicer ?? { cli: "claude" as const },
      (processed, total) => emit({ phase: "slicer_progress", processed, total }),
    );

    const roleTexts = extractRoleCorpus(slicerResults, input.role);

    const result = await runSnippetsStructureComposer({
      account: input.account,
      role: input.role,
      roleTexts,
      articles,
      limit,
      run_id,
      start,
      vaultPath: ctx.vaultPath,
      cliModelPerStep: ctx.cliModelPerStep,
      onPhase: emit,
    });

    return result;
  } catch (err) {
    emit({ phase: "failed", error: (err as Error).message });
    throw err;
  }
}

const ALL_ROLES: RoleDistillRole[] = ["opening", "practice", "closing"];

export async function runRoleDistillAll(
  input: AllRolesDistillInput,
  ctx: AllRolesDistillCtx,
): Promise<AllRolesDistillResult> {
  const emit = (ev: AllRolesDistillEvent) => ctx.onEvent?.(ev);
  const run_id = `rdall-${Date.now()}`;
  const start = Date.now();
  emit({ phase: "all.started", account: input.account, run_id });

  const limit = ctx.limit ?? 50;
  const concurrency = ctx.concurrency ?? 5;
  const articles = loadArticles(ctx.sqlitePath, input.account, limit);
  if (articles.length === 0) {
    const err = `no articles found for account: ${input.account}`;
    const results = ALL_ROLES.map((role) => ({ role, error: err }));
    for (const r of results) emit({ phase: "role_failed", role: r.role, error: err });
    emit({ phase: "all.finished", results });
    return { results };
  }

  // Slicer runs ONCE for all roles
  const slicerResults = await runSlicerPhase(
    articles,
    concurrency,
    ctx.cliModelPerStep?.slicer ?? { cli: "claude" as const },
    (processed, total) => emit({ phase: "slicer_progress", processed, total }),
  );

  // For each role with non-empty corpus, run snippets→structure→composer in parallel across roles.
  const rolePromises = ALL_ROLES.map(async (role) => {
    const roleTexts = extractRoleCorpus(slicerResults, role);
    if (roleTexts.length === 0) {
      const error = `no slices matched role=${role}`;
      emit({ phase: "role_failed", role, error });
      return { role, error };
    }
    emit({ phase: "role_started", role });
    try {
      const { panelPath, version } = await runSnippetsStructureComposer({
        account: input.account,
        role,
        roleTexts,
        articles,
        limit,
        run_id,
        start,
        vaultPath: ctx.vaultPath,
        cliModelPerStep: ctx.cliModelPerStep,
        // Per-role inner phases not surfaced in all-roles event stream;
        // only role_done / role_failed are emitted externally.
      });
      emit({ phase: "role_done", role, panel_path: panelPath, version });
      return { role, panelPath, version };
    } catch (err) {
      const error = (err as Error).message;
      emit({ phase: "role_failed", role, error });
      return { role, error };
    }
  });

  const settled = await Promise.all(rolePromises);
  const results: AllRolesDistillResult["results"] = settled.map((r) => ({
    role: r.role,
    panelPath: (r as any).panelPath,
    version: (r as any).version,
    error: (r as any).error,
  }));
  emit({
    phase: "all.finished",
    results: results.map((r) => ({
      role: r.role,
      panel_path: r.panelPath,
      version: r.version,
      error: r.error,
    })),
  });
  return { results };
}

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

    // Slicer phase (concurrency-bound)
    let processed = 0;
    const slicerOpts = ctx.cliModelPerStep?.slicer ?? { cli: "claude" as const };
    const slicerResults = await mapWithConcurrency(
      articles,
      concurrency,
      async (a) => {
        const r = await runSectionSlicer(a.body_plain, slicerOpts);
        return { articleId: a.id, body: a.body_plain, slices: r.slices };
      },
      () => {
        processed += 1;
        if (processed % 5 === 0 || processed === articles.length) {
          emit({ phase: "slicer_progress", processed, total: articles.length });
        }
      },
    );

    // Collect role-matching slice texts
    const roleTexts: string[] = [];
    for (const r of slicerResults) {
      if (!r) continue;
      const slices: SectionSlice[] = r.slices.filter((s) => s.role === input.role);
      for (const s of slices) {
        const text = r.body.slice(s.start_char, s.end_char).trim();
        if (text.length > 0) roleTexts.push(text);
      }
    }

    const corpus = roleTexts.join("\n\n---\n\n");

    // Snippets
    const snippetsAgent = new StyleDistillerSnippetsAgent(
      ctx.cliModelPerStep?.snippets ?? { cli: "claude" },
    );
    const snippetsRes = await snippetsAgent.harvest({
      account: input.account,
      batchIndex: 0,
      totalBatches: 1,
      articles: [
        {
          id: "corpus",
          title: `${input.account} ${input.role} corpus`,
          published_at: new Date().toISOString().slice(0, 10),
          word_count: corpus.length,
          body_plain: corpus,
        },
      ],
    });
    emit({ phase: "snippets_done", count: snippetsRes.candidates.length });

    // Structure
    const structureAgent = new StyleDistillerStructureAgent(
      ctx.cliModelPerStep?.structure ?? { cli: "claude" },
    );
    const structureRes = await structureAgent.distill({
      account: input.account,
      samples: [
        {
          id: "corpus",
          title: `${input.account} ${input.role} corpus`,
          published_at: new Date().toISOString().slice(0, 10),
          word_count: corpus.length,
          body_plain: corpus,
        },
      ],
      quantSummary: `role=${input.role} slices=${roleTexts.length} source_articles=${articles.length}`,
    });
    emit({ phase: "structure_done" });

    // Composer
    const composerAgent = new StyleDistillerComposerAgent(
      ctx.cliModelPerStep?.composer ?? { cli: "claude" },
    );
    const dates = articles.map((a) => a.published_at ?? "").filter(Boolean).sort();
    const composeRes = await composerAgent.compose({
      account: input.account,
      sampleSizeRequested: limit,
      sampleSizeActual: articles.length,
      sourcePoolSize: articles.length,
      articleDateRange: {
        start: dates[0] ?? "",
        end: dates[dates.length - 1] ?? "",
      },
      distilledAt: new Date().toISOString(),
      stepClis: {
        structure: ctx.cliModelPerStep?.structure ?? { cli: "claude" },
        snippets: ctx.cliModelPerStep?.snippets ?? { cli: "claude" },
        composer: ctx.cliModelPerStep?.composer ?? { cli: "claude" },
      },
      deepReadIds: articles.slice(0, Math.min(3, articles.length)).map((a) => a.id),
      quantJson: JSON.stringify({
        role: input.role,
        source_articles: articles.length,
        role_slice_count: roleTexts.length,
      }),
      structureMd: structureRes.text,
      snippetsYaml: JSON.stringify(snippetsRes.candidates, null, 2),
    });

    // Determine next version
    const store = new StylePanelStore(ctx.vaultPath);
    const existing = store.list().filter(
      (p) => p.frontmatter.account === input.account && p.frontmatter.role === input.role,
    );
    const nextVersion =
      existing.length === 0 ? 1 : Math.max(...existing.map((p) => p.frontmatter.version)) + 1;

    const frontmatter: StylePanelFrontmatter = {
      account: input.account,
      role: input.role,
      version: nextVersion,
      status: "active",
      created_at: new Date().toISOString(),
      source_article_count: articles.length,
      slicer_run_id: run_id,
      composer_duration_ms: Date.now() - start,
    };
    const panel: StylePanel = { frontmatter, body: composeRes.kbMd, absPath: "" };
    const panelPath = store.write(panel);
    emit({ phase: "composer_done", panel_path: panelPath });

    return { panelPath, version: nextVersion };
  } catch (err) {
    emit({ phase: "failed", error: (err as Error).message });
    throw err;
  }
}

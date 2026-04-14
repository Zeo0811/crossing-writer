import Database from "better-sqlite3";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  StyleDistillerStructureAgent,
  StyleDistillerSnippetsAgent,
  StyleDistillerComposerAgent,
} from "@crossing/agents";
import { analyzeQuant } from "./quant-analyzer.js";
import { stratifiedSample, pickDeepRead } from "./sample-picker.js";
import { aggregateSnippets } from "./snippet-aggregator.js";
import type {
  ArticleSample, DistillOptions, DistillResult, DistillStep, DistillStepEvent, QuantResult, SnippetCandidate,
} from "./types.js";

export interface DistillContext {
  vaultPath: string;
  sqlitePath: string;
}

const BATCH_SIZE = 25;

function loadPool(sqlitePath: string, account: string, since?: string, until?: string): { pool: ArticleSample[]; totalInRange: number } {
  const db = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  try {
    const where: string[] = ["account = @account"];
    const params: Record<string, unknown> = { account };
    if (since) { where.push("published_at >= @since"); params.since = since; }
    if (until) { where.push("published_at <= @until"); params.until = until; }
    const sql = `SELECT id, account, title, published_at, word_count, body_plain FROM ref_articles WHERE ${where.join(" AND ")} ORDER BY published_at DESC`;
    const rows = db.prepare(sql).all(params) as Array<{ id: string; account: string; title: string; published_at: string; word_count: number | null; body_plain: string | null }>;
    const pool: ArticleSample[] = rows.map((r) => ({
      id: r.id,
      account: r.account,
      title: r.title,
      published_at: r.published_at,
      word_count: r.word_count ?? (r.body_plain ?? "").length,
      body_plain: r.body_plain ?? "",
    }));
    return { pool, totalInRange: pool.length };
  } finally {
    db.close();
  }
}

function emit(onEvent: DistillOptions["onEvent"], ev: DistillStepEvent) {
  if (onEvent) {
    try { onEvent(ev); } catch { /* swallow user-handler errors */ }
  }
}

function quantSummary(q: QuantResult): string {
  return [
    `article_count=${q.article_count}`,
    `date_range=${q.date_range.start}~${q.date_range.end}`,
    `word_count median=${q.word_count.median} (P10=${q.word_count.p10} P90=${q.word_count.p90})`,
    `opening_words median=${q.opening_words.median}`,
    `closing_words median=${q.closing_words.median}`,
    `case_section_words median=${q.case_section_words.median}`,
    `paragraph_length_sentences median=${q.paragraph_length_sentences.median}`,
    `bold_per_section median=${q.bold_per_section.median}`,
    `image_to_text_ratio=${Math.round(q.image_to_text_ratio)}`,
    `pronoun we=${q.pronoun_ratio.we.toFixed(2)} you=${q.pronoun_ratio.you.toFixed(2)} none=${q.pronoun_ratio.none.toFixed(2)}`,
  ].join("\n");
}

function snippetsToYaml(grouped: Record<string, SnippetCandidate[]>): string {
  const lines: string[] = [];
  for (const tag of Object.keys(grouped).sort()) {
    lines.push(`${tag}:`);
    for (const s of grouped[tag]!) {
      const escaped = s.excerpt.replace(/"/g, '\\"');
      lines.push(`  - from: ${s.from}`);
      lines.push(`    excerpt: "${escaped}"`);
    }
  }
  return lines.join("\n");
}

export async function runDistill(options: DistillOptions, ctx: DistillContext): Promise<DistillResult> {
  const { account, sampleSize, since, until, onlyStep, dryRun, cliModelPerStep, onEvent } = options;
  const distillDir = join(ctx.vaultPath, ".distill", account);
  mkdirSync(distillDir, { recursive: true });
  const stepsRun: DistillStep[] = [];

  const runQuant = !onlyStep || onlyStep === "quant";
  const runStructure = !onlyStep || onlyStep === "structure";
  const runSnippets = !onlyStep || onlyStep === "snippets";
  const runComposer = !onlyStep || onlyStep === "composer";

  let quant: QuantResult | null = null;
  let sampleStats: { sampleSizeRequested: number; sampleSizeActual: number; sourcePoolSize: number; articleDateRange: { start: string; end: string } } | null = null;
  let deepReadIds: string[] = [];
  let samplePool: ArticleSample[] = [];
  let deepReadSamples: ArticleSample[] = [];

  if (runQuant) {
    const started = Date.now();
    emit(onEvent, { step: "quant", phase: "started", account });
    try {
      const { pool, totalInRange } = loadPool(ctx.sqlitePath, account, since, until);
      if (pool.length === 0) throw new Error(`no articles for account=${account} in date range`);
      samplePool = stratifiedSample(pool, sampleSize);
      deepReadSamples = pickDeepRead(samplePool, 7);
      deepReadIds = deepReadSamples.map((s) => s.id);
      quant = analyzeQuant(account, samplePool);
      sampleStats = {
        sampleSizeRequested: sampleSize,
        sampleSizeActual: samplePool.length,
        sourcePoolSize: totalInRange,
        articleDateRange: quant.date_range,
      };
      writeFileSync(join(distillDir, "quant.json"), JSON.stringify(quant, null, 2), "utf-8");
      writeFileSync(join(distillDir, "sample_stats.json"), JSON.stringify(sampleStats, null, 2), "utf-8");
      writeFileSync(join(distillDir, "deep_read_ids.json"), JSON.stringify(deepReadIds), "utf-8");
      writeFileSync(join(distillDir, "sample_pool_ids.json"), JSON.stringify(samplePool.map((s) => s.id)), "utf-8");
      stepsRun.push("quant");
      emit(onEvent, { step: "quant", phase: "completed", account, duration_ms: Date.now() - started, stats: { article_count: samplePool.length, source_pool: totalInRange } });
    } catch (err) {
      emit(onEvent, { step: "quant", phase: "failed", account, duration_ms: Date.now() - started, error: (err as Error).message });
      throw err;
    }
  }

  if (dryRun) {
    writeFileSync(join(distillDir, "distilled_at.txt"), `${new Date().toISOString()} dry-run sample_size=${sampleSize}\n`, "utf-8");
    return { account, kb_path: "", sample_size_actual: samplePool.length, steps_run: stepsRun };
  }

  const needsIntermediates = runStructure || runSnippets || runComposer;
  if (needsIntermediates && !quant) {
    const qp = join(distillDir, "quant.json");
    const sp = join(distillDir, "sample_stats.json");
    const dp = join(distillDir, "deep_read_ids.json");
    const pp = join(distillDir, "sample_pool_ids.json");
    if (!existsSync(qp) || !existsSync(sp)) {
      throw new Error(`missing intermediate: quant.json / sample_stats.json (run without --only-step or rerun earlier step first)`);
    }
    quant = JSON.parse(readFileSync(qp, "utf-8")) as QuantResult;
    sampleStats = JSON.parse(readFileSync(sp, "utf-8"));
    deepReadIds = existsSync(dp) ? JSON.parse(readFileSync(dp, "utf-8")) : [];
    if (runStructure || runSnippets) {
      const { pool } = loadPool(ctx.sqlitePath, account, since, until);
      const ids = existsSync(pp) ? new Set<string>(JSON.parse(readFileSync(pp, "utf-8"))) : null;
      samplePool = ids ? pool.filter((a) => ids.has(a.id)) : pool.slice(0, sampleStats!.sampleSizeActual);
      deepReadSamples = deepReadIds.length
        ? samplePool.filter((s) => deepReadIds.includes(s.id))
        : pickDeepRead(samplePool, 7);
      if (deepReadSamples.length === 0 && samplePool.length > 0) deepReadSamples = pickDeepRead(samplePool, 7);
    }
  }

  if (runStructure) {
    const started = Date.now();
    emit(onEvent, { step: "structure", phase: "started", account });
    try {
      const cliModel = cliModelPerStep?.structure ?? { cli: "claude" as const, model: "opus" };
      const agent = new StyleDistillerStructureAgent(cliModel);
      const out = await agent.distill({
        account,
        samples: deepReadSamples.map((s) => ({ id: s.id, title: s.title, published_at: s.published_at, word_count: s.word_count, body_plain: s.body_plain })),
        quantSummary: quantSummary(quant!),
      });
      writeFileSync(join(distillDir, "structure.md"), out.text, "utf-8");
      stepsRun.push("structure");
      emit(onEvent, { step: "structure", phase: "completed", account, duration_ms: Date.now() - started, stats: { bytes: out.text.length } });
    } catch (err) {
      emit(onEvent, { step: "structure", phase: "failed", account, duration_ms: Date.now() - started, error: (err as Error).message });
      throw err;
    }
  }

  if (runSnippets) {
    const started = Date.now();
    emit(onEvent, { step: "snippets", phase: "started", account });
    try {
      const cliModel = cliModelPerStep?.snippets ?? { cli: "claude" as const, model: "opus" };
      const agent = new StyleDistillerSnippetsAgent(cliModel);
      const batches: ArticleSample[][] = [];
      for (let i = 0; i < samplePool.length; i += BATCH_SIZE) batches.push(samplePool.slice(i, i + BATCH_SIZE));
      const all: SnippetCandidate[] = [];
      for (let i = 0; i < batches.length; i += 1) {
        const out = await agent.harvest({
          account,
          batchIndex: i,
          totalBatches: batches.length,
          articles: batches[i]!.map((a) => ({ id: a.id, title: a.title, published_at: a.published_at, word_count: a.word_count, body_plain: a.body_plain })),
        });
        all.push(...out.candidates);
        emit(onEvent, { step: "snippets", phase: "batch_progress", account, stats: { batch: i + 1, total_batches: batches.length, candidates_so_far: all.length } });
      }
      const grouped = aggregateSnippets(all);
      const yaml = snippetsToYaml(grouped);
      writeFileSync(join(distillDir, "snippets.yaml"), yaml, "utf-8");
      stepsRun.push("snippets");
      emit(onEvent, { step: "snippets", phase: "completed", account, duration_ms: Date.now() - started, stats: { raw: all.length, tags: Object.keys(grouped).length } });
    } catch (err) {
      emit(onEvent, { step: "snippets", phase: "failed", account, duration_ms: Date.now() - started, error: (err as Error).message });
      throw err;
    }
  }

  let kbPath = "";
  if (runComposer) {
    const started = Date.now();
    emit(onEvent, { step: "composer", phase: "started", account });
    try {
      const cliModel = cliModelPerStep?.composer ?? { cli: "claude" as const, model: "opus" };
      const agent = new StyleDistillerComposerAgent(cliModel);
      const quantJson = readFileSync(join(distillDir, "quant.json"), "utf-8");
      const structureMd = readFileSync(join(distillDir, "structure.md"), "utf-8");
      const snippetsYaml = readFileSync(join(distillDir, "snippets.yaml"), "utf-8");
      const stats = sampleStats ?? JSON.parse(readFileSync(join(distillDir, "sample_stats.json"), "utf-8"));
      const ids = deepReadIds.length ? deepReadIds : JSON.parse(readFileSync(join(distillDir, "deep_read_ids.json"), "utf-8"));
      const structureCli = cliModelPerStep?.structure ?? { cli: "claude" as const, model: "opus" };
      const snippetsCli = cliModelPerStep?.snippets ?? { cli: "claude" as const, model: "opus" };
      const out = await agent.compose({
        account,
        sampleSizeRequested: stats.sampleSizeRequested,
        sampleSizeActual: stats.sampleSizeActual,
        sourcePoolSize: stats.sourcePoolSize,
        articleDateRange: stats.articleDateRange,
        distilledAt: new Date().toISOString(),
        stepClis: { structure: structureCli, snippets: snippetsCli, composer: cliModel },
        deepReadIds: ids,
        quantJson,
        structureMd,
        snippetsYaml,
      });
      const panelDir = join(ctx.vaultPath, "08_experts", "style-panel");
      mkdirSync(panelDir, { recursive: true });
      kbPath = join(panelDir, `${account}_kb.md`);
      writeFileSync(kbPath, out.kbMd, "utf-8");
      stepsRun.push("composer");
      emit(onEvent, { step: "composer", phase: "completed", account, duration_ms: Date.now() - started, stats: { bytes: out.kbMd.length, path: kbPath } });
    } catch (err) {
      emit(onEvent, { step: "composer", phase: "failed", account, duration_ms: Date.now() - started, error: (err as Error).message });
      throw err;
    }
  }

  writeFileSync(join(distillDir, "distilled_at.txt"), `${new Date().toISOString()} steps=${stepsRun.join(",")} sample_size=${sampleSize}\n`, "utf-8");

  return {
    account,
    kb_path: kbPath,
    sample_size_actual: sampleStats?.sampleSizeActual ?? samplePool.length,
    steps_run: stepsRun,
  };
}

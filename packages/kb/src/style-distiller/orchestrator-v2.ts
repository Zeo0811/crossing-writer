import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import pLimit from 'p-limit';
import type { ArticleSample, DistillV2Options, DistillV2Result } from './types.js';
import { splitParagraphs } from './paragraph-splitter.js';
import { labelArticle, type LabelerInvoke } from './article-labeler.js';
import { aggregateBuckets } from './aggregator-v2.js';
import { composePanel, type ComposerInvoke } from './composer-v2.js';
import { WRITER_ROLES } from './panel-v2-schema.js';

export interface DistillV2Context {
  vaultPath: string;
  sqlitePath: string;
}

const BASE_SUBDIR = join('08_experts', 'style-panel');
const LABEL_CONCURRENCY = 10;

export async function runDistillV2(
  opts: DistillV2Options,
  ctx: DistillV2Context,
): Promise<DistillV2Result> {
  const emit = (type: string, data: Record<string, unknown> = {}) =>
    opts.onEvent?.({ type, data });

  try {
    emit('distill.started', {
      account: opts.account,
      sample_size: opts.sampleSize,
      run_id: opts.runId,
    });

    // [1] Sampling
    const pool = loadPool(ctx.sqlitePath, opts.account, opts.since, opts.until);
    const samples = pool.slice(0, opts.sampleSize);
    emit('sampling.done', { actual_count: samples.length });

    // [2] Per-article Labeling (parallel up to LABEL_CONCURRENCY)
    const paragraphsByArticle = new Map<string, string[]>();
    const limit = pLimit(LABEL_CONCURRENCY);
    let doneCount = 0;

    const labeled = await Promise.all(
      samples.map((sample) =>
        limit(async () => {
          const paragraphs = splitParagraphs(sample.body_plain);
          paragraphsByArticle.set(sample.id, paragraphs);
          const invoke: LabelerInvoke = { invoke: opts.invokeLabeler, paragraphs };
          const result = await labelArticle(sample, invoke);
          doneCount += 1;
          emit('labeling.article_done', {
            id: sample.id,
            type: result.type,
            progress: `${doneCount}/${samples.length}`,
          });
          return result;
        }),
      ),
    );
    emit('labeling.all_done', {});

    // [3] Aggregation (pure JS)
    const aggregated = aggregateBuckets(opts.account, samples, paragraphsByArticle, labeled);
    emit('aggregation.done', { buckets_count: aggregated.buckets.length });

    // [4] Composition (per role, parallel)
    const accountDir = join(ctx.vaultPath, BASE_SUBDIR, opts.account);
    mkdirSync(accountDir, { recursive: true });

    const files: string[] = [];
    await Promise.all(
      WRITER_ROLES.map(async (role) => {
        emit('composer.started', { role });
        const composerInvoke: ComposerInvoke = { invoke: opts.invokeComposer };
        const md = await composePanel(aggregated, role, composerInvoke);
        const absPath = join(accountDir, `${role}-v2.md`);
        writeFileSync(absPath, md, 'utf-8');
        files.push(absPath);
        emit('composer.done', { role, panel_path: absPath });
      }),
    );

    emit('distill.finished', { files });
    return { account: opts.account, files };
  } catch (err) {
    emit('distill.failed', { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

function loadPool(
  sqlitePath: string,
  account: string,
  since?: string,
  until?: string,
): ArticleSample[] {
  const db = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  try {
    const where: string[] = ['account = @account'];
    const params: Record<string, unknown> = { account };
    if (since) {
      where.push('published_at >= @since');
      params.since = since;
    }
    if (until) {
      where.push('published_at <= @until');
      params.until = until;
    }
    const sql = `SELECT id, account, title, published_at, word_count, body_plain
                 FROM ref_articles
                 WHERE ${where.join(' AND ')}
                 ORDER BY published_at DESC`;
    const rows = db.prepare(sql).all(params) as Array<{
      id: string;
      account: string;
      title: string;
      published_at: string;
      word_count: number | null;
      body_plain: string | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      account: r.account,
      title: r.title,
      published_at: r.published_at,
      word_count: r.word_count ?? (r.body_plain ?? '').length,
      body_plain: r.body_plain ?? '',
    }));
  } finally {
    db.close();
  }
}

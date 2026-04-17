import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import pLimit from 'p-limit';
import type { ArticleSample, DistillV2Options, DistillV2Result } from './types.js';
import { splitParagraphs } from './paragraph-splitter.js';
import { labelArticlesBatch } from './article-labeler.js';
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

    // [2] Per-article Labeling — batched for cost (5 articles per sonnet call).
    // Paragraph pre-splitting stays per-article (pure compute, sequential).
    const paragraphsByArticle = new Map<string, string[]>();
    for (const sample of samples) {
      const sourceBody = loadArticleBody(ctx.vaultPath, sample);
      const paragraphs = splitParagraphs(sourceBody);
      paragraphsByArticle.set(sample.id, paragraphs);
    }

    const BATCH_SIZE = 5;
    const batches: (typeof samples)[] = [];
    for (let i = 0; i < samples.length; i += BATCH_SIZE) {
      batches.push(samples.slice(i, i + BATCH_SIZE));
    }

    const limit = pLimit(LABEL_CONCURRENCY);
    let doneCount = 0;

    const labeledNested = await Promise.all(
      batches.map((batch) =>
        limit(async () => {
          const items = batch.map((sample) => ({
            sample,
            paragraphs: paragraphsByArticle.get(sample.id) ?? [],
          }));
          const results = await labelArticlesBatch(items, opts.invokeLabeler);
          for (const r of results) {
            doneCount += 1;
            emit('labeling.article_done', {
              id: r.articleId,
              type: r.type,
              progress: `${doneCount}/${samples.length}`,
            });
          }
          return results;
        }),
      ),
    );
    const labeled = labeledNested.flat();
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

interface ArticleSampleWithPath extends ArticleSample {
  md_path: string;
}

function loadPool(
  sqlitePath: string,
  account: string,
  since?: string,
  until?: string,
): ArticleSampleWithPath[] {
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
    const sql = `SELECT id, account, title, published_at, word_count, body_plain, md_path
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
      md_path: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      account: r.account,
      title: r.title,
      published_at: r.published_at,
      word_count: r.word_count ?? (r.body_plain ?? '').length,
      body_plain: r.body_plain ?? '',
      md_path: r.md_path,
    }));
  } finally {
    db.close();
  }
}

/**
 * Prefer the markdown file on disk (has real \n\n paragraph breaks) over
 * the sqlite body_plain column (which is whitespace-collapsed to one line).
 * Strip the YAML frontmatter before returning.
 */
function loadArticleBody(vaultPath: string, sample: ArticleSample & { md_path?: string }): string {
  const mdPath = sample.md_path;
  if (mdPath) {
    const abs = join(vaultPath, mdPath);
    if (existsSync(abs)) {
      const raw = readFileSync(abs, 'utf-8');
      return raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
    }
  }
  return sample.body_plain;
}

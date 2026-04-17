import Database from "better-sqlite3";
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { WikiIngestorAgent, type IngestArticle, type IngestorOp } from "@crossing/agents";
import { WikiStore } from "./wiki-store.js";
import { buildSnapshot } from "./snapshot-builder.js";
import { rebuildIndex } from "./index-maintainer.js";
import { extractImagesFromHtml, extractImagesFromMarkdown } from "./raw-image-extractor.js";
import type {
  IngestOptions, IngestResult, IngestStepEvent, PatchOp, WikiFrontmatter,
} from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface Ctx { vaultPath: string; sqlitePath: string }

function emit(cb: IngestOptions["onEvent"], ev: IngestStepEvent) {
  if (cb) { try { cb(ev); } catch { /* swallow */ } }
}

function ensureVaultScaffold(vault: string): void {
  mkdirSync(vault, { recursive: true });
  for (const d of ["entities", "concepts", "cases", "observations", "persons"]) {
    mkdirSync(join(vault, d), { recursive: true });
  }
  const guideTarget = join(vault, "CROSSING_WIKI_GUIDE.md");
  if (!existsSync(guideTarget)) {
    const seed = join(__dirname, "..", "..", "..", "agents", "src", "prompts", "CROSSING_WIKI_GUIDE.md");
    if (existsSync(seed)) copyFileSync(seed, guideTarget);
    else writeFileSync(guideTarget, "# CROSSING_WIKI_GUIDE\n\n(seed missing)\n", "utf-8");
  }
  if (!existsSync(join(vault, "log.md"))) writeFileSync(join(vault, "log.md"), "# Wiki Ingest Log\n\n", "utf-8");
}

function loadGuide(vault: string): string {
  const p = join(vault, "CROSSING_WIKI_GUIDE.md");
  return existsSync(p) ? readFileSync(p, "utf-8") : "";
}

function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function lastIngestedAt(vault: string, account: string): string | null {
  const logPath = join(vault, "log.md");
  if (!existsSync(logPath)) return null;
  const lines = readFileSync(logPath, "utf-8").split(/\r?\n/);
  let max: string | null = null;
  const re = new RegExp(`account=${escapeRe(account)} max_published_at=(\\S+)`);
  for (const l of lines) {
    const m = re.exec(l);
    if (m) { const v = m[1]!; if (!max || v > max) max = v; }
  }
  return max;
}

interface RawRow {
  id: string; account: string; title: string; published_at: string;
  body_plain: string | null; html_path: string | null;
}

function loadArticles(sqlitePath: string, account: string, opts: {
  perAccountLimit: number; since?: string; until?: string; mode: IngestOptions["mode"]; sinceAuto?: string | null;
  vaultRootPath?: string;
}): IngestArticle[] {
  const db = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  try {
    const where: string[] = ["account = @a"];
    const params: Record<string, unknown> = { a: account };
    if (opts.since) { where.push("published_at >= @s"); params.s = opts.since; }
    if (opts.until) { where.push("published_at <= @u"); params.u = opts.until; }
    if (opts.mode === "incremental" && opts.sinceAuto) { where.push("published_at > @sa"); params.sa = opts.sinceAuto; }
    const sql = `SELECT id, account, title, published_at, body_plain, html_path FROM ref_articles WHERE ${where.join(" AND ")} ORDER BY published_at DESC LIMIT @lim`;
    params.lim = opts.perAccountLimit;
    const rows = db.prepare(sql).all(params) as RawRow[];
    return rows.map((r) => {
      const bodyPlain = r.body_plain ?? "";
      let imgs: ReturnType<typeof extractImagesFromMarkdown> = [];
      if (r.html_path) {
        const abs = r.html_path.startsWith("/") ? r.html_path : (opts.vaultRootPath ? join(opts.vaultRootPath, r.html_path) : r.html_path);
        if (existsSync(abs)) {
          try { imgs = extractImagesFromHtml(readFileSync(abs, "utf-8")); } catch { /* ignore */ }
        }
      }
      if (imgs.length === 0) imgs = extractImagesFromMarkdown(bodyPlain);
      return {
        id: r.id, title: r.title, published_at: r.published_at, body_plain: bodyPlain, images: imgs,
      };
    });
  } finally { db.close(); }
}

function toPatchOp(op: IngestorOp): PatchOp | null {
  if (op.op === "upsert" && typeof op.path === "string") {
    return {
      op: "upsert",
      path: op.path,
      frontmatter: (op.frontmatter as Partial<WikiFrontmatter>) ?? {},
      body: (op.body as string) ?? "",
    };
  }
  if (op.op === "append_source" && typeof op.path === "string" && op.source) {
    return { op: "append_source", path: op.path, source: op.source as { account: string; article_id: string; quoted: string } };
  }
  if (op.op === "append_image" && typeof op.path === "string" && op.image) {
    return { op: "append_image", path: op.path, image: op.image as { url: string; caption?: string; from_article?: string } };
  }
  if (op.op === "add_backlink" && typeof op.path === "string" && typeof op.to === "string") {
    return { op: "add_backlink", path: op.path, to: op.to };
  }
  if (op.op === "note" && typeof op.body === "string") {
    return { op: "note", body: op.body };
  }
  return null;
}

export async function runIngest(opts: IngestOptions, ctx: Ctx): Promise<IngestResult> {
  // Validation: mode + articleIds consistency
  if (opts.mode === "selected" && (!opts.articleIds || opts.articleIds.length === 0)) {
    throw new Error("article_ids required for mode=selected");
  }
  if (opts.articleIds && opts.articleIds.length > 0 && opts.mode !== "selected") {
    throw new Error("article_ids implies mode=selected");
  }

  // maxArticles enforcement (only when explicitly provided)
  if (opts.maxArticles !== undefined) {
    const maxArticles = opts.maxArticles;
    const projectedCount = opts.mode === "selected"
      ? (opts.articleIds ?? []).length
      : opts.accounts.length * opts.perAccountLimit;
    if (projectedCount > maxArticles) {
      throw new Error(`max_articles exceeded: cap=${maxArticles} projected=${projectedCount}`);
    }
  } else if (opts.mode === "selected") {
    // Default cap of 50 for selected mode
    const maxArticles = 50;
    const projectedCount = (opts.articleIds ?? []).length;
    if (projectedCount > maxArticles) {
      throw new Error(`max_articles exceeded: cap=${maxArticles} projected=${projectedCount}`);
    }
  }

  if (opts.mode === "selected") {
    return runSelectedIngest(opts, ctx);
  }

  ensureVaultScaffold(ctx.vaultPath);
  const store = new WikiStore(ctx.vaultPath);
  const guide = loadGuide(ctx.vaultPath);
  const agent = new WikiIngestorAgent({ cli: opts.cliModel?.cli ?? "claude", model: opts.cliModel?.model });

  let pagesCreated = 0;
  let pagesUpdated = 0;
  let sourcesAppended = 0;
  let imagesAppended = 0;
  const notes: string[] = [];
  const accountsDone: string[] = [];

  for (const account of opts.accounts) {
    const sinceAuto = opts.mode === "incremental" ? lastIngestedAt(ctx.vaultPath, account) : null;
    const articles = loadArticles(ctx.sqlitePath, account, {
      perAccountLimit: opts.perAccountLimit,
      since: opts.since, until: opts.until,
      mode: opts.mode, sinceAuto,
      vaultRootPath: dirname(dirname(ctx.sqlitePath)),
    });
    if (articles.length === 0) {
      emit(opts.onEvent, { type: "account_completed", account, stats: { articles_processed: 0 } });
      accountsDone.push(account);
      continue;
    }
    const batches: IngestArticle[][] = [];
    for (let i = 0; i < articles.length; i += opts.batchSize) batches.push(articles.slice(i, i + opts.batchSize));

    let maxPublished = articles[0]!.published_at;
    let accountOps = 0;

    for (let bi = 0; bi < batches.length; bi += 1) {
      const batch = batches[bi]!;
      emit(opts.onEvent, { type: "batch_started", account, batchIndex: bi, totalBatches: batches.length, stats: { articles_in_batch: batch.length } });
      const t0 = Date.now();
      try {
        const snap = buildSnapshot(ctx.vaultPath, batch, 10);
        const res = await agent.ingest({
          account, batchIndex: bi, totalBatches: batches.length,
          articles: batch, existingPages: snap.pages, indexMd: snap.indexMd, wikiGuide: guide,
        });
        let opsApplied = 0;
        for (const rawOp of res.ops) {
          const patch = toPatchOp(rawOp);
          if (!patch) continue;
          try {
            const r = store.applyPatch(patch);
            opsApplied += 1;
            if (patch.op === "upsert") { if (r.created) pagesCreated += 1; if (r.updated) pagesUpdated += 1; }
            else if (patch.op === "append_source") sourcesAppended += 1;
            else if (patch.op === "append_image") imagesAppended += 1;
            else if (patch.op === "note" && r.noted) notes.push(r.noted);
            emit(opts.onEvent, { type: "op_applied", account, op: patch.op, path: patch.op !== "note" ? patch.path : undefined });
          } catch (e) {
            emit(opts.onEvent, { type: "op_applied", account, op: patch.op, error: (e as Error).message });
          }
        }
        accountOps += opsApplied;
        for (const a of batch) if (a.published_at > maxPublished) maxPublished = a.published_at;
        emit(opts.onEvent, { type: "batch_completed", account, batchIndex: bi, totalBatches: batches.length, duration_ms: Date.now() - t0, stats: { ops_applied: opsApplied } });
      } catch (e) {
        emit(opts.onEvent, { type: "batch_failed", account, batchIndex: bi, totalBatches: batches.length, error: (e as Error).message });
      }
    }

    appendFileSync(join(ctx.vaultPath, "log.md"), `- ${new Date().toISOString()} account=${account} max_published_at=${maxPublished} articles=${articles.length} ops=${accountOps}\n`, "utf-8");
    emit(opts.onEvent, { type: "account_completed", account, stats: { articles_processed: articles.length, ops: accountOps } });
    accountsDone.push(account);
  }

  rebuildIndex(ctx.vaultPath);
  emit(opts.onEvent, { type: "all_completed", stats: { accounts_done: accountsDone.length, pages_created: pagesCreated, pages_updated: pagesUpdated } });

  return { accounts_done: accountsDone, pages_created: pagesCreated, pages_updated: pagesUpdated, sources_appended: sourcesAppended, images_appended: imagesAppended, notes };
}

function loadArticlesByIds(sqlitePath: string, articleIds: string[]): IngestArticle[] {
  if (articleIds.length === 0) return [];
  const db = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  try {
    const placeholders = articleIds.map(() => "?").join(",");
    const rows = db.prepare(
      `SELECT id, account, title, published_at, body_plain, html_path
       FROM ref_articles WHERE id IN (${placeholders})`,
    ).all(...articleIds) as RawRow[];
    const vaultRoot = dirname(dirname(sqlitePath));
    return rows.map((r) => {
      const bodyPlain = r.body_plain ?? "";
      let imgs: ReturnType<typeof extractImagesFromMarkdown> = [];
      if (r.html_path) {
        const abs = r.html_path.startsWith("/") ? r.html_path : join(vaultRoot, r.html_path);
        if (existsSync(abs)) {
          try { imgs = extractImagesFromHtml(readFileSync(abs, "utf-8")); } catch { /* ignore */ }
        }
      }
      if (imgs.length === 0) imgs = extractImagesFromMarkdown(bodyPlain);
      return { id: r.id, title: r.title, published_at: r.published_at, body_plain: bodyPlain, images: imgs };
    });
  } finally { db.close(); }
}

async function runSelectedIngest(opts: IngestOptions, ctx: Ctx): Promise<IngestResult> {
  ensureVaultScaffold(ctx.vaultPath);
  const store = new WikiStore(ctx.vaultPath);
  const guide = loadGuide(ctx.vaultPath);
  const agent = new WikiIngestorAgent({ cli: opts.cliModel?.cli ?? "claude", model: opts.cliModel?.model });

  const articles = loadArticlesByIds(ctx.sqlitePath, opts.articleIds!);

  let pagesCreated = 0, pagesUpdated = 0, sourcesAppended = 0, imagesAppended = 0;
  const notes: string[] = [];

  const batches: IngestArticle[][] = [];
  for (let i = 0; i < articles.length; i += opts.batchSize) batches.push(articles.slice(i, i + opts.batchSize));

  for (let bi = 0; bi < batches.length; bi += 1) {
    const batch = batches[bi]!;
    emit(opts.onEvent, { type: "batch_started", account: "selected", batchIndex: bi, totalBatches: batches.length, stats: { articles_in_batch: batch.length } });
    const t0 = Date.now();
    try {
      const snap = buildSnapshot(ctx.vaultPath, batch, 10);
      const res = await agent.ingest({
        account: "selected", batchIndex: bi, totalBatches: batches.length,
        articles: batch, existingPages: snap.pages, indexMd: snap.indexMd, wikiGuide: guide,
      });
      let opsApplied = 0;
      for (const rawOp of res.ops) {
        const patch = toPatchOp(rawOp);
        if (!patch) continue;
        try {
          const r = store.applyPatch(patch);
          opsApplied += 1;
          if (patch.op === "upsert") { if (r.created) pagesCreated += 1; if (r.updated) pagesUpdated += 1; }
          else if (patch.op === "append_source") sourcesAppended += 1;
          else if (patch.op === "append_image") imagesAppended += 1;
          else if (patch.op === "note" && r.noted) notes.push(r.noted);
          emit(opts.onEvent, { type: "op_applied", account: "selected", op: patch.op, path: patch.op !== "note" ? patch.path : undefined });
        } catch (e) {
          emit(opts.onEvent, { type: "op_applied", account: "selected", op: patch.op, error: (e as Error).message });
        }
      }
      emit(opts.onEvent, { type: "batch_completed", account: "selected", batchIndex: bi, totalBatches: batches.length, duration_ms: Date.now() - t0, stats: { ops_applied: opsApplied } });
    } catch (e) {
      emit(opts.onEvent, { type: "batch_failed", account: "selected", batchIndex: bi, totalBatches: batches.length, error: (e as Error).message });
    }
  }

  rebuildIndex(ctx.vaultPath);
  emit(opts.onEvent, { type: "all_completed", stats: { pages_created: pagesCreated, pages_updated: pagesUpdated } });
  return { accounts_done: ["selected"], pages_created: pagesCreated, pages_updated: pagesUpdated, sources_appended: sourcesAppended, images_appended: imagesAppended, notes };
}

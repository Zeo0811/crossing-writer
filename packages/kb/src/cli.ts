import { Command } from "commander";
import Database from "better-sqlite3";
import { loadConfig } from "./db.js";
import { searchRefs } from "./search.js";
import type { DistillStep, DistillStepEvent } from "./style-distiller/types.js";

export function buildCli(): Command {
  const program = new Command();
  program
    .name("crossing-kb")
    .description("Crossing knowledge base CLI")
    .version("0.1.0");

  program.command("search <query>")
    .description("full-text search the reference articles vault")
    .option("-c, --config <path>", "config.json path", "config.json")
    .option("-a, --account <name...>", "filter by account(s)")
    .option("--author <name>", "filter by author")
    .option("--since <date>", "published_at >= YYYY-MM-DD")
    .option("--until <date>", "published_at <= YYYY-MM-DD")
    .option("--topic-core <name...>", "filter by core topic(s)")
    .option("--original", "only is_original")
    .option("-n, --limit <n>", "max results", "20")
    .option("--json", "output JSON array")
    .action((query: string, opts) => {
      const cfg = loadConfig(opts.config);
      const results = searchRefs(
        { sqlitePath: cfg.sqlitePath, vaultPath: cfg.vaultPath },
        {
          query: query === "_" ? undefined : query,
          account: opts.account,
          author: opts.author,
          dateFrom: opts.since,
          dateTo: opts.until,
          topicsCore: opts.topicCore,
          isOriginal: opts.original,
          limit: parseInt(opts.limit, 10),
        }
      );
      if (opts.json) {
        process.stdout.write(JSON.stringify(results, null, 2));
        return;
      }
      for (const r of results) {
        process.stdout.write(
          `${r.publishedAt}  [${r.account}]  ${r.title}\n  ${r.mdPath}\n\n`
        );
      }
    });

  program.command("list-accounts")
    .description("list accounts present in refs.sqlite with counts and date ranges")
    .option("-c, --config <path>", "config.json path", "config.json")
    .option("--json", "output JSON array")
    .action((opts) => {
      const cfg = loadConfig(opts.config);
      const db = new Database(cfg.sqlitePath, { readonly: true, fileMustExist: true });
      try {
        const rows = db.prepare(
          `SELECT account, COUNT(*) AS count, MIN(published_at) AS earliest_published_at, MAX(published_at) AS latest_published_at
           FROM ref_articles GROUP BY account ORDER BY count DESC`,
        ).all() as Array<{ account: string; count: number; earliest_published_at: string; latest_published_at: string }>;
        if (opts.json) {
          process.stdout.write(JSON.stringify(rows, null, 2));
          return;
        }
        for (const r of rows) {
          process.stdout.write(
            `${r.account}\t${r.count}\t${r.earliest_published_at} ~ ${r.latest_published_at}\n`,
          );
        }
      } finally {
        db.close();
      }
    });

  program.command("distill-style <account>")
    .description("distill style panel for an account via 4-step pipeline")
    .option("-c, --config <path>", "config.json path", "config.json")
    .option("--sample-size <n>", "sample size", "200")
    .option("--since <date>", "published_at >= YYYY-MM-DD")
    .option("--until <date>", "published_at <= YYYY-MM-DD")
    .option("--only-step <step>", "quant|structure|snippets|composer")
    .option("--dry-run", "only run quant step, do not write kb.md")
    .option("--structure-cli <cli>", "claude|codex for structure step")
    .option("--structure-model <m>", "model for structure step")
    .option("--snippets-cli <cli>", "claude|codex for snippets step")
    .option("--snippets-model <m>", "model for snippets step")
    .option("--composer-cli <cli>", "claude|codex for composer step")
    .option("--composer-model <m>", "model for composer step")
    .action(async (account: string, opts) => {
      const cfg = loadConfig(opts.config);
      const onlyStep = opts.onlyStep as DistillStep | undefined;
      if (onlyStep && !["quant","structure","snippets","composer"].includes(onlyStep)) {
        process.stderr.write(`invalid --only-step: ${onlyStep}\n`); process.exit(1);
      }
      const cliModelPerStep: Record<string, { cli: "claude" | "codex"; model?: string }> = {};
      if (opts.structureCli || opts.structureModel) cliModelPerStep.structure = { cli: (opts.structureCli as "claude" | "codex") ?? "claude", model: opts.structureModel };
      if (opts.snippetsCli || opts.snippetsModel) cliModelPerStep.snippets = { cli: (opts.snippetsCli as "claude" | "codex") ?? "claude", model: opts.snippetsModel };
      if (opts.composerCli || opts.composerModel) cliModelPerStep.composer = { cli: (opts.composerCli as "claude" | "codex") ?? "claude", model: opts.composerModel };

      const stepNames: Record<DistillStep, string> = {
        quant: "[1/4] quant-analyzer",
        structure: "[2/4] structure-distiller",
        snippets: "[3/4] snippet-harvester",
        composer: "[4/4] composer",
      };
      const t0 = Date.now();
      const onEvent = (ev: DistillStepEvent) => {
        if (ev.phase === "started") {
          process.stdout.write(`${stepNames[ev.step]}\n  → running...\n`);
        } else if (ev.phase === "batch_progress" && ev.stats) {
          process.stdout.write(`  → batch ${ev.stats.batch}/${ev.stats.total_batches}: ${ev.stats.candidates_so_far} candidates\n`);
        } else if (ev.phase === "completed") {
          const stats = ev.stats ?? {};
          const parts = Object.entries(stats).map(([k, v]) => `${k}=${v}`).join(" ");
          process.stdout.write(`  → done (${Math.round((ev.duration_ms ?? 0) / 1000)}s) ${parts}\n`);
        } else if (ev.phase === "failed") {
          process.stdout.write(`  → FAILED: ${ev.error}\n`);
        }
      };
      try {
        const { runDistill } = await import("./style-distiller/orchestrator.js");
        const result = await runDistill({
          account,
          sampleSize: parseInt(opts.sampleSize, 10),
          since: opts.since,
          until: opts.until,
          onlyStep,
          dryRun: !!opts.dryRun,
          cliModelPerStep: Object.keys(cliModelPerStep).length ? cliModelPerStep : undefined,
          onEvent,
        }, { vaultPath: cfg.vaultPath, sqlitePath: cfg.sqlitePath });
        process.stdout.write(`Total: ${Math.round((Date.now() - t0) / 1000)}s\n`);
        if (result.kb_path) process.stdout.write(`${result.kb_path}\n`);
      } catch (err) {
        process.stderr.write(`distill failed: ${(err as Error).message}\n`);
        process.exit(1);
      }
    });

  const wiki = program.command("wiki").description("Wiki knowledge base operations");

  wiki
    .command("ingest")
    .description("Ingest raw articles into wiki via Ingestor agent")
    .option("-c, --config <path>", "config.json path", "config.json")
    .requiredOption("--accounts <names>", "comma-separated wechat account names")
    .option("--per-account <n>", "max raw articles per account", "50")
    .option("--batch-size <n>", "articles per ingestor batch", "5")
    .option("--mode <mode>", "full | incremental", "full")
    .option("--since <iso>", "incremental: only after this iso ts")
    .option("--until <iso>", "incremental: only before this iso ts")
    .option("--cli <cli>", "claude | codex", "claude")
    .option("--model <model>", "opus | sonnet | haiku | gpt-5", "opus")
    .action(async (opts: { config: string; accounts: string; perAccount: string; batchSize: string; mode: string; since?: string; until?: string; cli: string; model: string }) => {
      const cfg = loadConfig(opts.config);
      const mode = opts.mode as "full" | "incremental";
      if (mode !== "full" && mode !== "incremental") {
        process.stderr.write(`invalid --mode: ${mode}\n`); process.exit(1);
      }
      const accounts = opts.accounts.split(",").map((a) => a.trim()).filter((a) => a.length > 0);
      const { runIngest } = await import("./wiki/orchestrator.js");
      try {
        const result = await runIngest({
          accounts,
          perAccountLimit: parseInt(opts.perAccount, 10),
          batchSize: parseInt(opts.batchSize, 10),
          mode,
          since: opts.since,
          until: opts.until,
          cliModel: { cli: opts.cli as "claude" | "codex", model: opts.model },
          onEvent: (ev: any) => {
            const parts: string[] = [`[ingest] ${ev.type}`];
            if (ev.account) parts.push(`account=${ev.account}`);
            if (ev.batchIndex !== undefined) parts.push(`batch=${ev.batchIndex + 1}/${ev.totalBatches}`);
            if (ev.op) parts.push(`op=${ev.op}`);
            if (ev.path) parts.push(`path=${ev.path}`);
            if (ev.duration_ms !== undefined) parts.push(`${ev.duration_ms}ms`);
            if (ev.error) parts.push(`error=${ev.error}`);
            if (ev.stats) parts.push(JSON.stringify(ev.stats));
            process.stdout.write(parts.join(" ") + "\n");
          },
        }, { vaultPath: cfg.vaultPath, sqlitePath: cfg.sqlitePath });
        process.stdout.write(`Done: pages_created=${result.pages_created} pages_updated=${result.pages_updated} sources_appended=${result.sources_appended} images_appended=${result.images_appended}\n`);
      } catch (err) {
        process.stderr.write(`ingest failed: ${(err as Error).message}\n`);
        process.exit(1);
      }
    });

  wiki
    .command("search <query>")
    .description("search wiki for matching pages")
    .option("-c, --config <path>", "config.json path", "config.json")
    .option("--kind <kind>", "entity | concept | case | observation | person")
    .option("--limit <n>", "max hits", "10")
    .action(async (query: string, opts: { config: string; kind?: string; limit: string }) => {
      const cfg = loadConfig(opts.config);
      const { searchWiki } = await import("./wiki/search-wiki.js");
      const results = await searchWiki(
        { query, kind: opts.kind as "entity" | "concept" | "case" | "observation" | "person" | undefined, limit: parseInt(opts.limit, 10) },
        { vaultPath: cfg.vaultPath },
      );
      for (const r of results) {
        process.stdout.write(`${r.score.toFixed(3)}\t${r.path}\t${r.title}\n`);
        if (r.excerpt) process.stdout.write(`        ${r.excerpt.slice(0, 200)}\n`);
      }
    });

  wiki
    .command("show <path>")
    .description("print raw markdown of a wiki page")
    .option("-c, --config <path>", "config.json path", "config.json")
    .action(async (path: string, opts: { config: string }) => {
      const cfg = loadConfig(opts.config);
      const { WikiStore } = await import("./wiki/wiki-store.js");
      const store = new WikiStore(cfg.vaultPath);
      let abs: string;
      try { abs = store.absPath(path); } catch { process.stderr.write("invalid path\n"); process.exit(1); return; }
      const { existsSync, readFileSync } = await import("node:fs");
      if (!existsSync(abs)) { process.stderr.write("not found\n"); process.exit(1); return; }
      process.stdout.write(readFileSync(abs, "utf-8"));
    });

  wiki
    .command("status")
    .description("show wiki summary (counts per kind + last_ingest)")
    .option("-c, --config <path>", "config.json path", "config.json")
    .action(async (opts: { config: string }) => {
      const cfg = loadConfig(opts.config);
      const { WikiStore } = await import("./wiki/wiki-store.js");
      const store = new WikiStore(cfg.vaultPath);
      const pages = store.listPages();
      const by_kind: Record<string, number> = { entity: 0, concept: 0, case: 0, observation: 0, person: 0 };
      let last: string | null = null;
      for (const p of pages) {
        by_kind[p.frontmatter.type] = (by_kind[p.frontmatter.type] ?? 0) + 1;
        const li = p.frontmatter.last_ingest;
        if (li && (!last || li > last)) last = li;
      }
      process.stdout.write(JSON.stringify({ total: pages.length, by_kind, last_ingest_at: last }, null, 2));
    });

  return program;
}

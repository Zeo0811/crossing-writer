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

  return program;
}

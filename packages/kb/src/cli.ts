import { Command } from "commander";
import { loadConfig } from "./db.js";
import { searchRefs } from "./search.js";

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

  return program;
}

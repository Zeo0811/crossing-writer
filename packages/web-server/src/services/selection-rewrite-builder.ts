import { WikiStore } from "@crossing/kb";
import Database from "better-sqlite3";
import { existsSync } from "node:fs";

export interface SelectionRef {
  kind: "wiki" | "raw";
  id: string;
  title: string;
  content: string;
  account?: string;
  published_at?: string;
}

export interface BuildArgs {
  sectionBody: string;
  selectedText: string;
  userPrompt: string;
  references: SelectionRef[];
}

const PER_REF_LIMIT = 3000;

export function buildSelectionRewriteUserMessage(args: BuildArgs): string {
  const refsBlock =
    args.references.length === 0
      ? "(无)"
      : args.references
          .map((r) => {
            const head =
              r.kind === "wiki"
                ? `## [wiki] ${r.title}`
                : `## [raw] ${r.title}${
                    r.account
                      ? ` (${r.account}${
                          r.published_at ? " " + r.published_at : ""
                        })`
                      : ""
                  }`;
            const body =
              r.content.length > PER_REF_LIMIT
                ? r.content.slice(0, PER_REF_LIMIT) + "\n...[truncated]"
                : r.content;
            return `${head}\n${body}`;
          })
          .join("\n\n");
  return [
    "[段落完整上下文]",
    args.sectionBody,
    "",
    "[需要改写的部分]",
    args.selectedText,
    "",
    "[引用素材]",
    refsBlock,
    "",
    "[改写要求]",
    args.userPrompt,
    "",
    "仅输出改写后的新文本（纯文本，不要 markdown 围栏、不要重复原文、不要解释）",
  ].join("\n");
}

export interface RefInput {
  kind: "wiki" | "raw";
  id: string;
  title: string;
  account?: string;
  published_at?: string;
}

export interface FetchCtx {
  vaultPath: string;
  sqlitePath: string;
}

export async function fetchReferenceBodies(
  refs: RefInput[],
  ctx: FetchCtx,
  logger?: { warn: (msg: string) => void },
): Promise<SelectionRef[]> {
  const out: SelectionRef[] = [];
  let db: Database.Database | null = null;
  try {
    for (const r of refs) {
      try {
        if (r.kind === "wiki") {
          const store = new WikiStore(ctx.vaultPath);
          const page = store.readPage(r.id);
          if (!page) {
            logger?.warn(`wiki not found: ${r.id}`);
            continue;
          }
          out.push({ ...r, content: page.body ?? "" });
        } else {
          if (!existsSync(ctx.sqlitePath)) {
            logger?.warn(`sqlite missing: ${ctx.sqlitePath}`);
            continue;
          }
          if (!db)
            db = new Database(ctx.sqlitePath, {
              readonly: true,
              fileMustExist: true,
            });
          const row = db
            .prepare("SELECT body_plain FROM ref_articles WHERE id = ?")
            .get(r.id) as { body_plain?: string } | undefined;
          if (!row) {
            logger?.warn(`raw not found: ${r.id}`);
            continue;
          }
          out.push({ ...r, content: row.body_plain ?? "" });
        }
      } catch (e) {
        logger?.warn(
          `fetchRef failed ${r.kind}:${r.id}: ${(e as Error).message}`,
        );
      }
    }
  } finally {
    if (db) db.close();
  }
  return out;
}

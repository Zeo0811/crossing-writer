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

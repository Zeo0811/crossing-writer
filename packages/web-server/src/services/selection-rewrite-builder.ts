export interface BuildArgs {
  sectionBody: string;
  selectedText: string;
  userPrompt: string;
}

export function buildSelectionRewriteUserMessage(args: BuildArgs): string {
  return [
    "[段落完整上下文]",
    args.sectionBody,
    "",
    "[需要改写的部分]",
    args.selectedText,
    "",
    "[改写要求]",
    args.userPrompt,
    "",
    "如果 [改写要求] 中出现 `@search_wiki <query>` 或 `@search_raw <query>`，优先调用对应工具拉取素材后再改写。",
    "",
    "仅输出改写后的新文本（纯文本，不要 markdown 围栏、不要重复原文、不要解释）",
  ].join("\n");
}

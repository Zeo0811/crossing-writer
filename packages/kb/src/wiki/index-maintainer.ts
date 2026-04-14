import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { WikiStore } from "./wiki-store.js";
import type { WikiKind, WikiPage } from "./types.js";

const KINDS: WikiKind[] = ["entity", "concept", "case", "observation", "person"];
const KIND_DIR: Record<WikiKind, string> = {
  entity: "entities", concept: "concepts", case: "cases", observation: "observations", person: "persons",
};

export function rebuildIndex(vaultPath: string): void {
  const store = new WikiStore(vaultPath);
  const pages = store.listPages();
  const byDir: Record<string, WikiPage[]> = { entities: [], concepts: [], cases: [], observations: [], persons: [] };
  for (const p of pages) {
    const top = p.path.split("/")[0]!;
    if (byDir[top]) byDir[top]!.push(p);
  }
  const lines: string[] = ["# Wiki Index", "", `_updated ${new Date().toISOString()}_`, ""];

  for (const kind of KINDS) {
    const dir = KIND_DIR[kind];
    const list = byDir[dir]!;
    lines.push(`## ${dir} (${list.length})`);
    list.sort((a, b) => a.frontmatter.title.localeCompare(b.frontmatter.title));
    for (const p of list) lines.push(`- [${p.frontmatter.title}](${p.path})`);
    lines.push("");
  }

  const heat = [...pages].map((p) => ({ p, n: (p.frontmatter.backlinks ?? []).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 30);
  lines.push(`## 热度（按 backlink 数）`);
  for (const { p, n } of heat) lines.push(`- [${p.frontmatter.title}](${p.path}) — ${n}`);
  lines.push("");

  writeFileSync(join(vaultPath, "index.md"), lines.join("\n"), "utf-8");
}

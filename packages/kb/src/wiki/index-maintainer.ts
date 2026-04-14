import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export function rebuildIndex(vaultPath: string): void {
  const p = join(vaultPath, "index.md");
  if (!existsSync(p)) writeFileSync(p, "# Wiki Index\n\n(to be filled)\n", "utf-8");
}

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

export interface ExpertEntry {
  name: string;
  file: string;
  active: boolean;
  default_preselect: boolean;
  specialty: string;
}

export class ExpertRegistry {
  constructor(private expertsRootDir: string) {}

  private loadIndex(panel: string): ExpertEntry[] {
    const raw = readFileSync(join(this.expertsRootDir, panel, "index.yaml"), "utf-8");
    const data = parseYaml(raw) as { experts: ExpertEntry[] };
    return data.experts ?? [];
  }

  listAll(panel: string): ExpertEntry[] {
    return this.loadIndex(panel);
  }

  listActive(panel: string): ExpertEntry[] {
    return this.loadIndex(panel).filter((e) => e.active);
  }

  defaultPreselected(panel: string): string[] {
    return this.listActive(panel)
      .filter((e) => e.default_preselect)
      .map((e) => e.name);
  }

  readKb(panel: string, name: string): string {
    const entry = this.listAll(panel).find((e) => e.name === name);
    if (!entry) throw new Error(`expert not found: ${name}`);
    return readFileSync(join(this.expertsRootDir, panel, entry.file), "utf-8");
  }
}

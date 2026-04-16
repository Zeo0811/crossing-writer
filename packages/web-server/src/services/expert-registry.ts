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

export interface ExpertRecord {
  name: string;
  file: string;
  active: boolean;
  default_preselect: boolean;
  specialty?: string;
  creativity_score?: number;
}

export class ExpertRegistry {
  constructor(private expertsRootDir: string) {}

  private loadIndex(panel: string): ExpertEntry[] {
    const raw = readFileSync(join(this.expertsRootDir, panel, "index.yaml"), "utf-8");
    const data = parseYaml(raw) as { experts: ExpertEntry[] };
    return data.experts ?? [];
  }

  private loadIndexAsRecords(panel: string): ExpertRecord[] {
    const raw = readFileSync(join(this.expertsRootDir, panel, "index.yaml"), "utf-8");
    const data = parseYaml(raw) as { experts: ExpertRecord[] };
    return data.experts ?? [];
  }

  listAll(panel: string): ExpertEntry[] {
    return this.loadIndex(panel);
  }

  listActive(panel: string): ExpertEntry[];
  listActive(): Promise<ExpertRecord[]>;
  listActive(panel?: string): ExpertEntry[] | Promise<ExpertRecord[]> {
    if (panel !== undefined) {
      return this.loadIndex(panel).filter((e) => e.active);
    }
    return Promise.resolve(
      this.loadIndexAsRecords("08_experts/topic-panel").filter((e) => e.active),
    );
  }

  defaultPreselected(panel: string): string[] {
    return (this.listActive(panel) as ExpertEntry[])
      .filter((e) => e.default_preselect)
      .map((e) => e.name);
  }

  readKb(panel: string, name: string): string {
    const entry = this.listAll(panel).find((e) => e.name === name);
    if (!entry) throw new Error(`expert not found: ${name}`);
    // index.yaml may omit `file` for entries created by the TopicExpertStore,
    // which lives at <panel>/experts/<name>_kb.md. Fall back to that convention.
    const filename = entry.file ?? `experts/${name}_kb.md`;
    return readFileSync(join(this.expertsRootDir, panel, filename), "utf-8");
  }

  async topByCreativity(n: number): Promise<ExpertRecord[]> {
    const all = await this.listActive();
    return all
      .filter((e) => typeof e.creativity_score === "number")
      .sort((a, b) => (b.creativity_score ?? 0) - (a.creativity_score ?? 0))
      .slice(0, n);
  }
}

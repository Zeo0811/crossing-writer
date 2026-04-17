import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AgentConfigEntry } from "./agent-config-store.js";
import type { DefaultModelConfig } from "../config.js";

export interface ProjectOverride {
  agents: Partial<Record<string, Partial<AgentConfigEntry>>>;
  defaultModel?: Partial<DefaultModelConfig>;
}

export class ProjectOverrideStore {
  constructor(private projectsDir: string) {}

  private pathFor(projectId: string): string {
    return join(this.projectsDir, projectId, "config.override.json");
  }

  get(projectId: string): ProjectOverride | null {
    const p = this.pathFor(projectId);
    if (!existsSync(p)) return null;
    try {
      const raw = JSON.parse(readFileSync(p, "utf-8"));
      if (!raw || typeof raw !== "object") return null;
      if (!raw.agents || typeof raw.agents !== "object") {
        return { agents: {} };
      }
      return raw as ProjectOverride;
    } catch {
      return null;
    }
  }

  set(projectId: string, override: ProjectOverride): void {
    const p = this.pathFor(projectId);
    mkdirSync(dirname(p), { recursive: true });
    const tmp = `${p}.tmp.${process.pid}.${Date.now()}`;
    writeFileSync(tmp, JSON.stringify(override, null, 2), "utf-8");
    renameSync(tmp, p);
  }

  clear(projectId: string, agentKey: string): void {
    const current = this.get(projectId);
    if (!current) return;
    if (!current.agents[agentKey]) return;
    delete current.agents[agentKey];
    if (Object.keys(current.agents).length === 0) {
      this.delete(projectId);
      return;
    }
    this.set(projectId, current);
  }

  delete(projectId: string): void {
    const p = this.pathFor(projectId);
    if (existsSync(p)) unlinkSync(p);
  }
}

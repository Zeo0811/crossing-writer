import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import type { AgentConfig } from "@crossing/agents";

function expand(p: string): string {
  return p.startsWith("~") ? resolve(homedir(), p.slice(2)) : p;
}

export interface DefaultModelEntry {
  cli: "claude" | "codex";
  model?: string;
}

export interface DefaultModelConfig {
  writer: DefaultModelEntry;
  other: DefaultModelEntry;
}

export interface ServerConfig {
  vaultPath: string;
  sqlitePath: string;
  projectsDir: string;
  expertsDir: string;
  defaultCli: "claude" | "codex";
  fallbackCli: "claude" | "codex";
  defaultModel: DefaultModelConfig;
  agents: Record<string, AgentConfig>;
  configPath: string;
}

const HARDCODED_DEFAULT_MODEL: DefaultModelConfig = {
  writer: { cli: "claude", model: "claude-opus-4-6" },
  other:  { cli: "claude", model: "claude-sonnet-4-5" },
};

function migrateRaw(raw: Record<string, unknown>): { migrated: boolean; result: Record<string, unknown> } {
  let migrated = false;
  const agents = (raw.agents ?? {}) as Record<string, AgentConfig & { reference_accounts?: string[] }>;

  if (!raw.defaultModel) {
    migrated = true;
    const writerAgent = Object.entries(agents).find(([k]) => k.startsWith("writer."));
    const otherAgent  = Object.entries(agents).find(([k]) => !k.startsWith("writer."));
    raw.defaultModel = {
      writer: writerAgent
        ? { cli: writerAgent[1].cli, ...(writerAgent[1].model !== undefined ? { model: writerAgent[1].model } : {}) }
        : HARDCODED_DEFAULT_MODEL.writer,
      other: otherAgent
        ? { cli: otherAgent[1].cli, ...(otherAgent[1].model !== undefined ? { model: otherAgent[1].model } : {}) }
        : HARDCODED_DEFAULT_MODEL.other,
    };
  }

  for (const [key, entry] of Object.entries(agents)) {
    if ('model' in entry) {
      delete (entry as { model?: unknown }).model;
      migrated = true;
    }
    if ('reference_accounts' in entry) {
      delete (entry as { reference_accounts?: unknown }).reference_accounts;
      migrated = true;
    }
    agents[key] = entry;
  }
  raw.agents = agents;

  return { migrated, result: raw };
}

export function loadServerConfig(path: string): ServerConfig {
  const raw = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  const { migrated, result } = migrateRaw(raw);
  if (migrated) {
    const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
    writeFileSync(tmp, JSON.stringify(result, null, 2), "utf-8");
    renameSync(tmp, path);
  }
  const vaultPath = expand(result.vaultPath as string);
  const modelAdapter = (result.modelAdapter ?? {}) as { defaultCli?: string; fallbackCli?: string };
  return {
    vaultPath,
    sqlitePath: expand(result.sqlitePath as string),
    projectsDir: join(vaultPath, "07_projects"),
    expertsDir: join(vaultPath, "08_experts"),
    defaultCli: (modelAdapter.defaultCli ?? "claude") as "claude" | "codex",
    fallbackCli: (modelAdapter.fallbackCli ?? "claude") as "claude" | "codex",
    defaultModel: result.defaultModel as DefaultModelConfig,
    agents: (result.agents ?? {}) as Record<string, AgentConfig>,
    configPath: resolve(path),
  };
}

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

export interface AgentConfig {
  cli: "claude" | "codex";
  model?: string;
  reference_accounts?: string[];
}

export interface CrossingConfig {
  vaultPath: string;
  sqlitePath: string;
  modelAdapter: {
    defaultCli: "claude" | "codex";
    fallbackCli: "claude" | "codex";
  };
  agents?: Record<string, AgentConfig>;
}

function expand(p: string): string {
  return p.startsWith("~") ? resolve(homedir(), p.slice(2)) : p;
}

export function loadConfig(path: string): CrossingConfig {
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  return {
    vaultPath: expand(raw.vaultPath),
    sqlitePath: expand(raw.sqlitePath),
    modelAdapter: raw.modelAdapter,
    agents: raw.agents ?? {},
  };
}

export function resolveAgent(cfg: CrossingConfig, key: string): AgentConfig {
  if (cfg.agents?.[key]) return cfg.agents[key]!;
  const role = key.split(".")[0]!;
  const defaultKey = `${role}.default`;
  if (cfg.agents?.[defaultKey]) return cfg.agents[defaultKey]!;
  return { cli: cfg.modelAdapter.defaultCli };
}

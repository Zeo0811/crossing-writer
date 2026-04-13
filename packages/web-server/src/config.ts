import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";

function expand(p: string): string {
  return p.startsWith("~") ? resolve(homedir(), p.slice(2)) : p;
}

export interface ServerConfig {
  vaultPath: string;
  sqlitePath: string;
  projectsDir: string;
  expertsDir: string;
  defaultCli: "claude" | "codex";
  fallbackCli: "claude" | "codex";
  configPath: string;
}

export function loadServerConfig(path: string): ServerConfig {
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  const vaultPath = expand(raw.vaultPath);
  return {
    vaultPath,
    sqlitePath: expand(raw.sqlitePath),
    projectsDir: join(vaultPath, "07_projects"),
    expertsDir: join(vaultPath, "08_experts"),
    defaultCli: raw.modelAdapter.defaultCli,
    fallbackCli: raw.modelAdapter.fallbackCli,
    configPath: resolve(path),
  };
}

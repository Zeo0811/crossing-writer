import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { loadServerConfig, type ServerConfig, type DefaultModelConfig } from "../config.js";
import type { AgentConfig } from "@crossing/agents";

export interface AgentConfigPatch {
  defaultCli?: "claude" | "codex";
  fallbackCli?: "claude" | "codex";
  agents?: Record<string, AgentConfig>;
  defaultModel?: Partial<DefaultModelConfig>;
}

export interface ConfigStore {
  readonly current: ServerConfig;
  update(patch: AgentConfigPatch): Promise<void>;
}

export function createConfigStore(path: string): ConfigStore {
  let current = loadServerConfig(path);
  let writeQueue: Promise<void> = Promise.resolve();

  async function doUpdate(patch: AgentConfigPatch): Promise<void> {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    if (patch.defaultCli != null) {
      raw.modelAdapter ??= {};
      raw.modelAdapter.defaultCli = patch.defaultCli;
    }
    if (patch.fallbackCli != null) {
      raw.modelAdapter ??= {};
      raw.modelAdapter.fallbackCli = patch.fallbackCli;
    }
    if (patch.agents != null) {
      raw.agents = patch.agents;
    }
    if (patch.defaultModel != null) {
      const current = (raw.defaultModel ?? {}) as Record<string, unknown>;
      raw.defaultModel = { ...current, ...patch.defaultModel };
    }
    const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
    writeFileSync(tmp, JSON.stringify(raw, null, 2), "utf-8");
    renameSync(tmp, path);
    current = loadServerConfig(path);
  }

  return {
    get current() { return current; },
    update(patch) {
      writeQueue = writeQueue.then(() => doUpdate(patch));
      return writeQueue;
    },
  };
}

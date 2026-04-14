import { describe, it, expect } from "vitest";
import { mergeAgentConfig, mergeAllAgentConfigs } from "../src/services/config-merger.js";
import type { AgentConfigEntry } from "../src/services/agent-config-store.js";

const base: AgentConfigEntry = {
  agentKey: "writer.opening",
  model: { cli: "claude", model: "opus" },
  promptVersion: "v1",
  styleBinding: { account: "A", role: "opening" },
  tools: { search_wiki: true, search_raw: true },
};

describe("mergeAgentConfig", () => {
  it("no override returns deep clone", () => {
    const out = mergeAgentConfig(base);
    expect(out).toEqual(base);
    expect(out).not.toBe(base);
    expect(out.model).not.toBe(base.model);
    expect(out.tools).not.toBe(base.tools);
    expect(out.styleBinding).not.toBe(base.styleBinding);
  });

  it("override.model replaces whole model", () => {
    const out = mergeAgentConfig(base, { model: { cli: "codex", model: "gpt-5" } });
    expect(out.model).toEqual({ cli: "codex", model: "gpt-5" });
  });

  it("override.promptVersion wins", () => {
    const out = mergeAgentConfig(base, { promptVersion: "v2" });
    expect(out.promptVersion).toBe("v2");
  });

  it("override.styleBinding replaces whole object", () => {
    const out = mergeAgentConfig(base, {
      styleBinding: { account: "B", role: "closing" },
    });
    expect(out.styleBinding).toEqual({ account: "B", role: "closing" });
  });

  it("override.tools shallow-merged per key", () => {
    const out = mergeAgentConfig(base, { tools: { search_raw: false } });
    expect(out.tools).toEqual({ search_wiki: true, search_raw: false });
  });

  it("agentKey always from global even if override specifies one", () => {
    const out = mergeAgentConfig(base, { agentKey: "writer.closing" } as any);
    expect(out.agentKey).toBe("writer.opening");
  });

  it("missing fields fall back to global", () => {
    const out = mergeAgentConfig(base, {});
    expect(out).toEqual(base);
  });

  it("handles global without tools + override with tools", () => {
    const minimal: AgentConfigEntry = {
      agentKey: "writer.opening",
      model: { cli: "claude" },
    };
    const out = mergeAgentConfig(minimal, { tools: { search_wiki: true } });
    expect(out.tools).toEqual({ search_wiki: true });
  });
});

describe("mergeAllAgentConfigs", () => {
  it("passes through missing agent entries untouched", () => {
    const globals: Record<string, AgentConfigEntry> = {
      "writer.opening": base,
      "writer.closing": { ...base, agentKey: "writer.closing" },
    };
    const merged = mergeAllAgentConfigs(globals, {
      agents: { "writer.opening": { model: { cli: "codex" } } },
    });
    expect(merged["writer.closing"]).toEqual(globals["writer.closing"]);
    expect(merged["writer.opening"]!.model.cli).toBe("codex");
  });

  it("null override returns clones of all globals", () => {
    const globals: Record<string, AgentConfigEntry> = { "writer.opening": base };
    const merged = mergeAllAgentConfigs(globals, null);
    expect(merged["writer.opening"]).toEqual(base);
    expect(merged["writer.opening"]).not.toBe(base);
  });

  it("empty override agents map leaves globals intact", () => {
    const globals: Record<string, AgentConfigEntry> = { "writer.opening": base };
    const merged = mergeAllAgentConfigs(globals, { agents: {} });
    expect(merged["writer.opening"]).toEqual(base);
  });
});

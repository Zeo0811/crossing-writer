import { describe, it, expect, vi } from "vitest";
import {
  createAgentConfigStore,
  DEFAULT_AGENT_CONFIGS,
  type AgentConfigEntry,
} from "../src/services/agent-config-store.js";

function fakeConfigStore(initial: Record<string, AgentConfigEntry> = {}) {
  let current: any = { agents: { ...initial } };
  return {
    get current() { return current; },
    update: vi.fn(async (patch: any) => {
      if (patch.agents !== undefined) current = { ...current, agents: patch.agents };
    }),
  };
}

const validEntry: AgentConfigEntry = {
  agentKey: "writer.opening",
  model: { cli: "claude", model: "opus" },
  styleBinding: { account: "A", role: "opening" },
  tools: { search_wiki: true, search_raw: true },
};

describe("AgentConfigStore", () => {
  it("set + get roundtrip", async () => {
    const cs = fakeConfigStore();
    const s = createAgentConfigStore(cs as any);
    await s.set("writer.opening", validEntry);
    expect(s.get("writer.opening")!.styleBinding!.account).toBe("A");
    expect(cs.update).toHaveBeenCalledTimes(1);
  });

  it("getAll returns all agents", async () => {
    const cs = fakeConfigStore();
    const s = createAgentConfigStore(cs as any);
    await s.set("writer.opening", validEntry);
    await s.set("writer.closing", { ...validEntry, agentKey: "writer.closing", styleBinding: { account: "A", role: "closing" } });
    const all = s.getAll();
    expect(Object.keys(all).sort()).toEqual(["writer.closing", "writer.opening"]);
  });

  it("get returns null for missing key", () => {
    const s = createAgentConfigStore(fakeConfigStore() as any);
    expect(s.get("writer.opening")).toBeNull();
  });

  it("rejects unknown agentKey", async () => {
    const s = createAgentConfigStore(fakeConfigStore() as any);
    await expect(
      s.set("junk.agent", { ...validEntry, agentKey: "junk.agent" } as any),
    ).rejects.toThrow(/invalid agent config/);
  });

  it("rejects bad cli", async () => {
    const s = createAgentConfigStore(fakeConfigStore() as any);
    await expect(
      s.set("writer.opening", { agentKey: "writer.opening", model: { cli: "gpt" } } as any),
    ).rejects.toThrow(/cli must be/);
  });

  it("rejects styleBinding with bad role", async () => {
    const s = createAgentConfigStore(fakeConfigStore() as any);
    await expect(
      s.set("writer.opening", {
        agentKey: "writer.opening",
        model: { cli: "claude" },
        styleBinding: { account: "A", role: "intro" },
      } as any),
    ).rejects.toThrow(/styleBinding\.role/);
  });

  it("rejects styleBinding with empty account", async () => {
    const s = createAgentConfigStore(fakeConfigStore() as any);
    await expect(
      s.set("writer.opening", {
        agentKey: "writer.opening",
        model: { cli: "claude" },
        styleBinding: { account: "", role: "opening" },
      } as any),
    ).rejects.toThrow(/account/);
  });

  it("remove deletes key", async () => {
    const cs = fakeConfigStore();
    const s = createAgentConfigStore(cs as any);
    await s.set("writer.opening", validEntry);
    await s.remove("writer.opening");
    expect(s.get("writer.opening")).toBeNull();
  });

  it("remove on missing key is noop", async () => {
    const cs = fakeConfigStore();
    const s = createAgentConfigStore(cs as any);
    await s.remove("writer.opening");
    expect(cs.update).not.toHaveBeenCalled();
  });

  it("accepts all allowlisted keys", async () => {
    const s = createAgentConfigStore(fakeConfigStore() as any);
    for (const key of ["style_critic", "section_slicer", "style_distiller.composer", "coordinator"]) {
      await s.set(key, { agentKey: key, model: { cli: "claude" } });
      expect(s.get(key)).not.toBeNull();
    }
  });

  it("accepts topic_expert.<specialty> with CJK", async () => {
    const s = createAgentConfigStore(fakeConfigStore() as any);
    for (const key of ["topic_expert.赛博禅心", "topic_expert.数字生命卡兹克", "topic_expert.foo-bar"]) {
      await s.set(key, { agentKey: key, model: { cli: "claude" } });
      expect(s.get(key)).not.toBeNull();
    }
  });

  it("SP-15: seeds section_slicer default to claude-sonnet-4-5", () => {
    const s = createAgentConfigStore(fakeConfigStore() as any);
    const entry = s.get("section_slicer");
    expect(entry).not.toBeNull();
    expect(entry!.model.cli).toBe("claude");
    expect(entry!.model.model).toBe("claude-sonnet-4-5");
    expect(DEFAULT_AGENT_CONFIGS.section_slicer.model.model).toBe("claude-sonnet-4-5");
  });

  it("SP-15: user-set section_slicer model overrides the default", async () => {
    const cs = fakeConfigStore();
    const s = createAgentConfigStore(cs as any);
    await s.set("section_slicer", {
      agentKey: "section_slicer",
      model: { cli: "claude", model: "claude-opus-4-6" },
    });
    const entry = s.get("section_slicer");
    expect(entry!.model.model).toBe("claude-opus-4-6");
  });

  it("rejects malformed topic_expert subkey", async () => {
    const s = createAgentConfigStore(fakeConfigStore() as any);
    await expect(
      s.set("topic_expert.", { agentKey: "topic_expert.", model: { cli: "claude" } } as any),
    ).rejects.toThrow(/invalid agent config/);
  });
});

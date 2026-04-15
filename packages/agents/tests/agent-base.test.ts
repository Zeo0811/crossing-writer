import { describe, it, expect, vi } from "vitest";
import { AgentBase } from "../src/agent-base.js";
import * as ma from "../src/model-adapter.js";

describe("AgentBase", () => {
  it("calls invokeAgent with resolved cli and interpolated prompt", async () => {
    const spy = vi.spyOn(ma, "invokeAgent").mockResolvedValue({
      text: "ok",
      meta: { cli: "claude", durationMs: 10 },
    });

    const agent = new AgentBase({
      key: "brief_analyst",
      systemPromptTemplate: "You are {{role}}.",
      vars: { role: "a Brief Analyst" },
      cli: "claude",
    });

    const out = await agent.run("please analyze this");
    expect(out.text).toBe("ok");
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        cli: "claude",
        systemPrompt: "You are a Brief Analyst.",
        userMessage: "please analyze this",
      }),
    );
  });

  it("interpolates multiple variables", async () => {
    const spy = vi.spyOn(ma, "invokeAgent").mockResolvedValue({
      text: "",
      meta: { cli: "codex", durationMs: 0 },
    });

    const agent = new AgentBase({
      key: "x",
      systemPromptTemplate: "{{a}} and {{b}}",
      vars: { a: "A", b: "B" },
      cli: "codex",
    });
    await agent.run("msg");
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ systemPrompt: "A and B" }),
    );
  });

  it("merges extraVars over constructor vars", async () => {
    const spy = vi.spyOn(ma, "invokeAgent").mockResolvedValue({
      text: "",
      meta: { cli: "claude", durationMs: 0 },
    });
    const agent = new AgentBase({
      key: "x",
      systemPromptTemplate: "{{a}} {{b}}",
      vars: { a: "base-a", b: "base-b" },
      cli: "claude",
    });
    await agent.run("", { b: "override-b" });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ systemPrompt: "base-a override-b" }),
    );
  });

  it("leaves unknown placeholders as empty string", async () => {
    const spy = vi.spyOn(ma, "invokeAgent").mockResolvedValue({
      text: "",
      meta: { cli: "claude", durationMs: 0 },
    });
    const agent = new AgentBase({
      key: "x",
      systemPromptTemplate: "hi {{missing}} end",
      vars: {},
      cli: "claude",
    });
    await agent.run("");
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ systemPrompt: "hi  end" }),
    );
  });
});

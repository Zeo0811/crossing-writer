import { describe, it, expect, vi } from "vitest";
import { AgentBase } from "../src/agent-base.js";
import * as ma from "../src/model-adapter.js";

describe("AgentBase", () => {
  it("calls invokeAgent with resolved cli and interpolated prompt", () => {
    const spy = vi.spyOn(ma, "invokeAgent").mockReturnValue({
      text: "ok",
      meta: { cli: "claude", durationMs: 10 },
    });

    const agent = new AgentBase({
      key: "brief_analyst",
      systemPromptTemplate: "You are {{role}}.",
      vars: { role: "a Brief Analyst" },
      cli: "claude",
    });

    const out = agent.run("please analyze this");
    expect(out.text).toBe("ok");
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        cli: "claude",
        systemPrompt: "You are a Brief Analyst.",
        userMessage: "please analyze this",
      }),
    );
  });

  it("interpolates multiple variables", () => {
    const spy = vi.spyOn(ma, "invokeAgent").mockReturnValue({
      text: "",
      meta: { cli: "codex", durationMs: 0 },
    });

    const agent = new AgentBase({
      key: "x",
      systemPromptTemplate: "{{a}} and {{b}}",
      vars: { a: "A", b: "B" },
      cli: "codex",
    });
    agent.run("msg");
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ systemPrompt: "A and B" }),
    );
  });

  it("merges extraVars over constructor vars", () => {
    const spy = vi.spyOn(ma, "invokeAgent").mockReturnValue({
      text: "",
      meta: { cli: "claude", durationMs: 0 },
    });
    const agent = new AgentBase({
      key: "x",
      systemPromptTemplate: "{{a}} {{b}}",
      vars: { a: "base-a", b: "base-b" },
      cli: "claude",
    });
    agent.run("", { b: "override-b" });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ systemPrompt: "base-a override-b" }),
    );
  });

  it("leaves unknown placeholders as empty string", () => {
    const spy = vi.spyOn(ma, "invokeAgent").mockReturnValue({
      text: "",
      meta: { cli: "claude", durationMs: 0 },
    });
    const agent = new AgentBase({
      key: "x",
      systemPromptTemplate: "hi {{missing}} end",
      vars: {},
      cli: "claude",
    });
    agent.run("");
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ systemPrompt: "hi  end" }),
    );
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawnSync: vi.fn() };
});

import { spawnSync } from "node:child_process";
import { invokeAgent } from "../src/model-adapter.js";

describe("invokeAgent", () => {
  beforeEach(() => { vi.mocked(spawnSync).mockReset(); });

  it("invokes codex exec with --output-last-message for codex cli", () => {
    vi.mocked(spawnSync).mockImplementation(((cmd: string, args: readonly string[]) => {
      const outIdx = args.indexOf("--output-last-message");
      if (outIdx >= 0) writeFileSync(args[outIdx + 1]!, "mocked response");
      return { status: 0, stdout: Buffer.from(""), stderr: Buffer.from("") } as any;
    }) as any);

    const result = invokeAgent({
      agentKey: "topic_expert.赛博禅心",
      cli: "codex",
      systemPrompt: "you are an expert",
      userMessage: "analyze this brief",
    });

    expect(result.text).toBe("mocked response");
    expect(result.meta.cli).toBe("codex");
    const call = vi.mocked(spawnSync).mock.calls[0]!;
    expect(call[0]).toBe("codex");
    expect(call[1]).toContain("exec");
    expect(call[1]).toContain("--output-last-message");
  });

  it("invokes claude -p for claude cli", () => {
    vi.mocked(spawnSync).mockReturnValue({
      status: 0,
      stdout: Buffer.from("claude response"),
      stderr: Buffer.from(""),
    } as any);

    const result = invokeAgent({
      agentKey: "brief_analyst",
      cli: "claude",
      systemPrompt: "you analyze briefs",
      userMessage: "here is a brief",
    });

    expect(result.text).toBe("claude response");
    const call = vi.mocked(spawnSync).mock.calls[0]!;
    expect(call[0]).toBe("claude");
    expect(call[1]).toContain("-p");
  });

  it("throws on non-zero exit with stderr content", () => {
    vi.mocked(spawnSync).mockReturnValue({
      status: 1,
      stdout: Buffer.from(""),
      stderr: Buffer.from("auth error"),
    } as any);

    expect(() =>
      invokeAgent({ agentKey: "x", cli: "claude", systemPrompt: "", userMessage: "" })
    ).toThrow(/auth error/);
  });

  it("passes model option for codex via -m flag", () => {
    vi.mocked(spawnSync).mockImplementation(((cmd: string, args: readonly string[]) => {
      const outIdx = args.indexOf("--output-last-message");
      if (outIdx >= 0) writeFileSync(args[outIdx + 1]!, "ok");
      return { status: 0, stdout: Buffer.from(""), stderr: Buffer.from("") } as any;
    }) as any);

    invokeAgent({
      agentKey: "x",
      cli: "codex",
      systemPrompt: "s",
      userMessage: "u",
      model: "gpt-5.4",
    });
    const call = vi.mocked(spawnSync).mock.calls[0]!;
    expect(call[1]).toContain("-m");
    expect(call[1]).toContain("gpt-5.4");
  });
});

describe("invokeAgent with images", () => {
  beforeEach(() => { vi.mocked(spawnSync).mockReset(); });

  it("passes -i <path> per image for codex cli", () => {
    vi.mocked(spawnSync).mockImplementation(((cmd: string, args: readonly string[]) => {
      const outIdx = args.indexOf("--output-last-message");
      if (outIdx >= 0) writeFileSync(args[outIdx + 1]!, "ok");
      return { status: 0, stdout: Buffer.from(""), stderr: Buffer.from("") } as any;
    }) as any);

    invokeAgent({
      agentKey: "product_overview",
      cli: "codex",
      systemPrompt: "describe images",
      userMessage: "",
      images: ["/abs/img-1.png", "/abs/img-2.png"],
    });

    const call = vi.mocked(spawnSync).mock.calls[0]!;
    const args = call[1] as string[];
    expect(args).toContain("--image=/abs/img-1.png");
    expect(args).toContain("--image=/abs/img-2.png");
  });

  it("embeds @<path> references in prompt for claude cli", () => {
    vi.mocked(spawnSync).mockReturnValue({
      status: 0,
      stdout: Buffer.from("ok"),
      stderr: Buffer.from(""),
    } as any);

    invokeAgent({
      agentKey: "x",
      cli: "claude",
      systemPrompt: "sys",
      userMessage: "user",
      images: ["/abs/a.png", "/abs/b.png"],
    });

    const call = vi.mocked(spawnSync).mock.calls[0]!;
    const args = call[1] as string[];
    expect(args[0]).toBe("-p");
    const prompt = args[1] as string;
    expect(prompt).toContain("@/abs/a.png");
    expect(prompt).toContain("@/abs/b.png");
    expect(args).not.toContain("--image");
  });

  it("no-op when images is empty or undefined", () => {
    vi.mocked(spawnSync).mockReturnValue({
      status: 0, stdout: Buffer.from("ok"), stderr: Buffer.from(""),
    } as any);
    invokeAgent({
      agentKey: "x", cli: "claude",
      systemPrompt: "", userMessage: "",
    });
    const call = vi.mocked(spawnSync).mock.calls[0]!;
    const args = call[1] as string[];
    expect(args.some((a: string) => a === "--image" || a.startsWith("--image="))).toBe(false);
    expect(args).not.toContain("-i");
    // no image refs in prompt either
    const prompt = args[1] as string;
    expect(prompt).not.toMatch(/@\//);
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import { writeFileSync } from "node:fs";
import { EventEmitter } from "node:events";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn() };
});

import { spawn } from "node:child_process";
import { invokeAgent } from "../src/model-adapter.js";

type SpawnResult = { status: number | null; stdout?: string; stderr?: string };

function mockChild(result: SpawnResult, sideEffect?: (args: readonly string[]) => void) {
  return ((_cmd: string, args: readonly string[]) => {
    if (sideEffect) sideEffect(args);
    const child = new EventEmitter() as any;
    const stdout = new EventEmitter() as any;
    const stderr = new EventEmitter() as any;
    const stdin: any = { end: (_?: unknown) => {}, on: (_e: string, _cb: unknown) => stdin };
    child.stdout = stdout;
    child.stderr = stderr;
    child.stdin = stdin;
    child.kill = () => {};
    process.nextTick(() => {
      if (result.stdout) stdout.emit("data", Buffer.from(result.stdout));
      if (result.stderr) stderr.emit("data", Buffer.from(result.stderr));
      child.emit("close", result.status);
    });
    return child;
  }) as any;
}

describe("invokeAgent", () => {
  beforeEach(() => { vi.mocked(spawn).mockReset(); });

  it("invokes codex exec with --output-last-message for codex cli", async () => {
    vi.mocked(spawn).mockImplementation(
      mockChild({ status: 0 }, (args) => {
        const outIdx = args.indexOf("--output-last-message");
        if (outIdx >= 0) writeFileSync(args[outIdx + 1]!, "mocked response");
      }),
    );

    const result = await invokeAgent({
      agentKey: "topic_expert.赛博禅心",
      cli: "codex",
      systemPrompt: "you are an expert",
      userMessage: "analyze this brief",
    });

    expect(result.text).toBe("mocked response");
    expect(result.meta.cli).toBe("codex");
    const call = vi.mocked(spawn).mock.calls[0]!;
    expect(call[0]).toBe("codex");
    expect(call[1]).toContain("exec");
    expect(call[1]).toContain("--output-last-message");
  });

  it("invokes claude -p for claude cli", async () => {
    vi.mocked(spawn).mockImplementation(mockChild({ status: 0, stdout: "claude response" }));

    const result = await invokeAgent({
      agentKey: "brief_analyst",
      cli: "claude",
      systemPrompt: "you analyze briefs",
      userMessage: "here is a brief",
    });

    expect(result.text).toBe("claude response");
    const call = vi.mocked(spawn).mock.calls[0]!;
    expect(call[0]).toBe("claude");
    expect(call[1]).toContain("-p");
  });

  it("throws on non-zero exit with stderr content", async () => {
    vi.mocked(spawn).mockImplementation(mockChild({ status: 1, stderr: "auth error" }));

    await expect(
      invokeAgent({ agentKey: "x", cli: "claude", systemPrompt: "", userMessage: "" }),
    ).rejects.toThrow(/auth error/);
  });

  it("passes model option for codex via -m flag", async () => {
    vi.mocked(spawn).mockImplementation(
      mockChild({ status: 0 }, (args) => {
        const outIdx = args.indexOf("--output-last-message");
        if (outIdx >= 0) writeFileSync(args[outIdx + 1]!, "ok");
      }),
    );

    await invokeAgent({
      agentKey: "x",
      cli: "codex",
      systemPrompt: "s",
      userMessage: "u",
      model: "gpt-5.4",
    });
    const call = vi.mocked(spawn).mock.calls[0]!;
    expect(call[1]).toContain("-m");
    expect(call[1]).toContain("gpt-5.4");
  });
});

describe("invokeAgent with images", () => {
  beforeEach(() => { vi.mocked(spawn).mockReset(); });

  it("passes --image=<path> per image for codex cli", async () => {
    vi.mocked(spawn).mockImplementation(
      mockChild({ status: 0 }, (args) => {
        const outIdx = args.indexOf("--output-last-message");
        if (outIdx >= 0) writeFileSync(args[outIdx + 1]!, "ok");
      }),
    );

    await invokeAgent({
      agentKey: "product_overview",
      cli: "codex",
      systemPrompt: "describe images",
      userMessage: "",
      images: ["/abs/img-1.png", "/abs/img-2.png"],
    });

    const call = vi.mocked(spawn).mock.calls[0]!;
    const args = call[1] as string[];
    expect(args).toContain("--image=/abs/img-1.png");
    expect(args).toContain("--image=/abs/img-2.png");
  });

  it("embeds @<path> references in prompt for claude cli", async () => {
    let capturedInput: Buffer | undefined;
    vi.mocked(spawn).mockImplementation(((_cmd: string, _args: readonly string[]) => {
      const child = new EventEmitter() as any;
      const stdout = new EventEmitter() as any;
      const stderr = new EventEmitter() as any;
      const stdin: any = {
        end: (b?: unknown) => {
          if (b instanceof Buffer) capturedInput = b;
          else if (typeof b === "string") capturedInput = Buffer.from(b);
        },
        on: (_e: string, _cb: unknown) => stdin,
      };
      child.stdout = stdout;
      child.stderr = stderr;
      child.stdin = stdin;
      child.kill = () => {};
      process.nextTick(() => {
        stdout.emit("data", Buffer.from("ok"));
        child.emit("close", 0);
      });
      return child;
    }) as any);

    await invokeAgent({
      agentKey: "x",
      cli: "claude",
      systemPrompt: "sys",
      userMessage: "user",
      images: ["/abs/a.png", "/abs/b.png"],
    });

    const call = vi.mocked(spawn).mock.calls[0]!;
    const args = call[1] as string[];
    expect(args[0]).toBe("-p");
    expect(args[1]).toBe("-");
    const prompt = capturedInput ? capturedInput.toString("utf-8") : "";
    expect(prompt).toContain("@/abs/a.png");
    expect(prompt).toContain("@/abs/b.png");
    expect(args).not.toContain("--image");
  });

  it("no-op when images is empty or undefined", async () => {
    vi.mocked(spawn).mockImplementation(mockChild({ status: 0, stdout: "ok" }));
    await invokeAgent({
      agentKey: "x", cli: "claude",
      systemPrompt: "", userMessage: "",
    });
    const call = vi.mocked(spawn).mock.calls[0]!;
    const args = call[1] as string[];
    expect(args.some((a: string) => a === "--image" || a.startsWith("--image="))).toBe(false);
    expect(args).not.toContain("-i");
  });
});

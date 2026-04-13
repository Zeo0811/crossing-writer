import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));
import { spawnSync } from "node:child_process";

import { runCrossingKbSearch, parseToolCalls } from "../src/tool-runner.js";

describe("parseToolCalls", () => {
  it("extracts crossing-kb search invocations from agent output", () => {
    const text = [
      "Some reasoning...",
      "```tool",
      `crossing-kb search "agent workflow" --account 量子位 --limit 5`,
      "```",
      "more text",
    ].join("\n");
    const calls = parseToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.command).toBe("crossing-kb");
    expect(calls[0]!.args).toContain("search");
    expect(calls[0]!.args).toContain("agent workflow");
    expect(calls[0]!.args).toContain("量子位");
  });

  it("extracts multiple tool blocks", () => {
    const text = [
      "```tool",
      `crossing-kb search "a"`,
      "```",
      "mid",
      "```tool",
      `crossing-kb search "b" --limit 3`,
      "```",
    ].join("\n");
    const calls = parseToolCalls(text);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.args).toContain("a");
    expect(calls[1]!.args).toContain("b");
    expect(calls[1]!.args).toContain("3");
  });

  it("returns empty when no tool blocks", () => {
    expect(parseToolCalls("no tools here")).toEqual([]);
  });

  it("skips empty tool blocks", () => {
    expect(parseToolCalls("```tool\n\n```")).toEqual([]);
  });
});

describe("runCrossingKbSearch", () => {
  beforeEach(() => { vi.mocked(spawnSync).mockReset(); });

  it("invokes crossing-kb CLI with json flag and parses output", () => {
    vi.mocked(spawnSync).mockReturnValue({
      status: 0,
      stdout: Buffer.from(JSON.stringify([{ title: "t", mdPath: "/a.md" }])),
      stderr: Buffer.from(""),
    } as any);
    const result = runCrossingKbSearch(["search", "agent", "--limit", "3"]);
    expect(result.ok).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data![0]!.title).toBe("t");
    const call = vi.mocked(spawnSync).mock.calls[0]!;
    expect(call[1]).toContain("--json");
  });

  it("returns error on non-zero exit", () => {
    vi.mocked(spawnSync).mockReturnValue({
      status: 1,
      stdout: Buffer.from(""),
      stderr: Buffer.from("boom"),
    } as any);
    const result = runCrossingKbSearch(["search", "x"]);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/boom/);
  });

  it("returns error on unparseable stdout", () => {
    vi.mocked(spawnSync).mockReturnValue({
      status: 0,
      stdout: Buffer.from("not json"),
      stderr: Buffer.from(""),
    } as any);
    const result = runCrossingKbSearch(["search", "x"]);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/parse|json/i);
  });

  it("does not add --json twice if already present", () => {
    vi.mocked(spawnSync).mockReturnValue({
      status: 0, stdout: Buffer.from("[]"), stderr: Buffer.from(""),
    } as any);
    runCrossingKbSearch(["search", "x", "--json"]);
    const call = vi.mocked(spawnSync).mock.calls[0]!;
    const jsonFlags = call[1]!.filter((a: string) => a === "--json");
    expect(jsonFlags).toHaveLength(1);
  });
});

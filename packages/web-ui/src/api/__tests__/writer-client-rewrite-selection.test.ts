import { describe, it, expect, vi, beforeEach } from "vitest";
import { rewriteSelection } from "../writer-client.js";

function sseBody(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(ctrl) {
      for (const c of chunks) ctrl.enqueue(enc.encode(c));
      ctrl.close();
    },
  });
}

function mkFrame(type: string, data: Record<string, unknown>): string {
  return `event: ${type}\ndata: ${JSON.stringify({ ts: 1, ...data })}\n\n`;
}

async function flush() {
  // Let the async IIFE inside rewriteSelection drain the mock stream.
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

describe("rewriteSelection SSE client", () => {
  beforeEach(() => {
    (globalThis as any).fetch = vi.fn();
  });

  it("dispatches parsed SSE events in order to the listener", async () => {
    (globalThis as any).fetch = vi.fn(async () => ({
      ok: true,
      body: sseBody([
        mkFrame("writer.started", {
          section_key: "intro",
          mode: "rewrite-selection",
          match_index: 0,
        }),
        mkFrame("writer.tool_called", {
          agent: "writer.opening",
          tool: "search_kb",
          args: ["foo"],
        }),
        mkFrame("writer.tool_returned", {
          agent: "writer.opening",
          tool: "search_kb",
          ok: true,
        }),
        mkFrame("writer.selection_rewritten", {
          section_key: "intro",
          selected_text: "old",
          new_text: "NEW",
          match_index: 0,
          content_full: "prefix NEW suffix",
        }),
        mkFrame("writer.completed", { section_key: "intro" }),
      ]),
    }));

    const events: Array<{ type: string; data?: any; error?: string }> = [];
    const stream = rewriteSelection("p1", "intro", {
      selected_text: "old",
      user_prompt: "make it better",
      references: [],
    });
    stream.onEvent((e) => events.push(e));
    await flush();

    expect(events.map((e) => e.type)).toEqual([
      "writer.started",
      "writer.tool_called",
      "writer.tool_returned",
      "writer.selection_rewritten",
      "writer.completed",
    ]);
    const rewritten = events.find((e) => e.type === "writer.selection_rewritten")!;
    expect(rewritten.data.new_text).toBe("NEW");
    expect(rewritten.data.content_full).toBe("prefix NEW suffix");
    expect(rewritten.data.match_index).toBe(0);
  });

  it("emits writer.failed when response is not ok", async () => {
    (globalThis as any).fetch = vi.fn(async () => ({
      ok: false,
      status: 400,
      body: null,
    }));
    const events: Array<{ type: string; error?: string }> = [];
    const s = rewriteSelection("p1", "intro", {
      selected_text: "a",
      user_prompt: "b",
      references: [],
    });
    s.onEvent((e) => events.push(e));
    await flush();

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("writer.failed");
    expect(events[0]!.error).toMatch(/400/);
  });

  it("emits writer.failed when fetch throws", async () => {
    (globalThis as any).fetch = vi.fn(async () => {
      throw new Error("network down");
    });
    const events: Array<{ type: string; error?: string }> = [];
    const s = rewriteSelection("p1", "intro", {
      selected_text: "a",
      user_prompt: "b",
      references: [],
    });
    s.onEvent((e) => events.push(e));
    await flush();

    expect(events[0]!.type).toBe("writer.failed");
    expect(events[0]!.error).toBe("network down");
  });

  it("handles SSE frames split across chunk boundaries", async () => {
    const full =
      mkFrame("writer.started", { section_key: "intro" }) +
      mkFrame("writer.completed", { section_key: "intro" });
    const mid = Math.floor(full.length / 2);
    (globalThis as any).fetch = vi.fn(async () => ({
      ok: true,
      body: sseBody([full.slice(0, mid), full.slice(mid)]),
    }));
    const events: Array<{ type: string }> = [];
    const s = rewriteSelection("p1", "intro", {
      selected_text: "a",
      user_prompt: "b",
      references: [],
    });
    s.onEvent((e) => events.push(e));
    await flush();

    expect(events.map((e) => e.type)).toEqual([
      "writer.started",
      "writer.completed",
    ]);
  });

  it("close() aborts the fetch", async () => {
    let capturedSignal: AbortSignal | undefined;
    (globalThis as any).fetch = vi.fn(async (_url: string, init: RequestInit) => {
      capturedSignal = init.signal as AbortSignal;
      return {
        ok: true,
        body: sseBody([mkFrame("writer.started", { section_key: "intro" })]),
      };
    });
    const s = rewriteSelection("p1", "intro", {
      selected_text: "a",
      user_prompt: "b",
      references: [],
    });
    s.onEvent(() => {});
    s.close();
    await flush();
    expect(capturedSignal?.aborted).toBe(true);
  });
});

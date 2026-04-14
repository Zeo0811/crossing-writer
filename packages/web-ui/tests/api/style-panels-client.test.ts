import { describe, it, expect, vi, beforeEach } from "vitest";
import { getAccounts, listStylePanels, startDistillStream } from "../../src/api/style-panels-client.js";

function sseBody(events: Array<{ type: string; data: any }>): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(ctrl) {
      for (const e of events) ctrl.enqueue(enc.encode(`event: ${e.type}\ndata: ${JSON.stringify(e.data)}\n\n`));
      ctrl.close();
    },
  });
}

describe("style-panels-client", () => {
  beforeEach(() => { (globalThis as any).fetch = vi.fn(); });

  it("getAccounts GETs /api/kb/accounts and returns JSON", async () => {
    (fetch as any).mockResolvedValue({ ok: true, json: async () => [{ account: "A", count: 10, earliest_published_at: "2025-01-01", latest_published_at: "2025-12-01" }] });
    const rows = await getAccounts();
    expect(rows[0]!.account).toBe("A");
    expect((fetch as any).mock.calls[0]![0]).toBe("/api/kb/accounts");
  });

  it("listStylePanels GETs /api/kb/style-panels", async () => {
    (fetch as any).mockResolvedValue({ ok: true, json: async () => [{ id: "X", path: "/x.md", last_updated_at: "2026-01-01T00:00:00Z" }] });
    const rows = await listStylePanels();
    expect(rows[0]!.id).toBe("X");
  });

  it("startDistillStream POSTs and parses SSE events", async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      body: sseBody([
        { type: "distill.step_started", data: { step: "quant", account: "X" } },
        { type: "distill.step_completed", data: { step: "quant", duration_ms: 100 } },
        { type: "distill.all_completed", data: { account: "X", kb_path: "/x.md", sample_size_actual: 20, steps_run: ["quant"] } },
      ]),
    });
    const events: any[] = [];
    await startDistillStream("X", { sample_size: 20 }, (ev) => events.push(ev));
    expect(events.map((e) => e.type)).toEqual([
      "distill.step_started", "distill.step_completed", "distill.all_completed",
    ]);
    expect(events[2]!.data.kb_path).toBe("/x.md");
    const call = (fetch as any).mock.calls[0];
    expect(call[0]).toBe("/api/kb/style-panels/X/distill");
    expect(call[1].method).toBe("POST");
    expect(call[1].body).toContain("sample_size");
  });
});

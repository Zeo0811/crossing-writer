import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  listTopicExperts,
  getTopicExpert,
  setTopicExpert,
  createTopicExpert,
  deleteTopicExpert,
  distillTopicExpert,
  consultTopicExperts,
} from "../../src/api/writer-client";

function sseBody(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const chunk of chunks) c.enqueue(enc.encode(chunk));
      c.close();
    },
  });
}

describe("writer-client topic-experts", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as any;
  });

  it("listTopicExperts hits GET /api/topic-experts", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ experts: [] }),
      text: async () => "",
    });
    const r = await listTopicExperts();
    expect(r.experts).toEqual([]);
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/topic-experts");
  });

  it("listTopicExperts adds include_deleted=1 when flag set", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ experts: [] }), text: async () => "",
    });
    await listTopicExperts({ includeDeleted: true });
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/topic-experts?include_deleted=1");
  });

  it("getTopicExpert hits GET /api/topic-experts/foo; 404 rejects", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false, status: 404, text: async () => "not_found", json: async () => ({}),
    });
    await expect(getTopicExpert("foo")).rejects.toThrow(/404/);
  });

  it("setTopicExpert PUTs JSON body", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ ok: true, expert: {} }), text: async () => "",
    });
    await setTopicExpert("alice", { active: false });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/topic-experts/alice");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ active: false });
  });

  it("createTopicExpert POSTs and propagates 409", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false, status: 409, text: async () => "dup", json: async () => ({}),
    });
    await expect(createTopicExpert({ name: "alice", specialty: "zen" })).rejects.toThrow(/409/);
  });

  it("deleteTopicExpert default → mode=soft; hard works", async () => {
    fetchMock.mockResolvedValue({
      ok: true, status: 200, json: async () => ({ ok: true, mode: "soft" }), text: async () => "",
    });
    await deleteTopicExpert("alice");
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/topic-experts/alice?mode=soft");
    fetchMock.mockClear();
    fetchMock.mockResolvedValue({
      ok: true, status: 200, json: async () => ({ ok: true, mode: "hard" }), text: async () => "",
    });
    await deleteTopicExpert("alice", { mode: "hard" });
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/topic-experts/alice?mode=hard");
  });

  it("distillTopicExpert streams events via SSE", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200,
      body: sseBody([
        "event: distill.started\ndata: {\"name\":\"alice\"}\n\n",
        "event: distill.done\ndata: {\"version\":1}\n\n",
      ]),
    });
    const events: Array<{ type: string; data: unknown }> = [];
    const { abort } = distillTopicExpert("alice", { mode: "initial" }, {
      onEvent: (type, data) => events.push({ type, data }),
    });
    await new Promise((r) => setTimeout(r, 30));
    abort();
    expect(events.map((e) => e.type)).toEqual(["distill.started", "distill.done"]);
  });

  it("consultTopicExperts streams events", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200,
      body: sseBody([
        "event: topic_consult.started\ndata: {\"selected\":[\"A\"]}\n\n",
        "event: expert_done\ndata: {\"name\":\"A\",\"markdown\":\"md\"}\n\n",
        "event: all_done\ndata: {\"succeeded\":[\"A\"],\"failed\":[]}\n\n",
      ]),
    });
    const events: string[] = [];
    consultTopicExperts(
      "p1",
      { selected: ["A"], invokeType: "score" },
      { onEvent: (type) => events.push(type) },
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(events).toContain("topic_consult.started");
    expect(events).toContain("all_done");
  });
});

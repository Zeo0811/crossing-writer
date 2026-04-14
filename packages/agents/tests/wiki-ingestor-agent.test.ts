import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/model-adapter.js", () => ({
  invokeAgent: vi.fn(),
}));

import { invokeAgent } from "../src/model-adapter.js";
import { WikiIngestorAgent } from "../src/roles/wiki-ingestor-agent.js";

const mockInvoke = invokeAgent as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => { mockInvoke.mockReset(); });

describe("WikiIngestorAgent", () => {
  it("builds user message containing guide + articles + existing snapshot and returns parsed ops", async () => {
    mockInvoke.mockReturnValue({
      text: [
        `{"op":"upsert","path":"entities/E.md","frontmatter":{"type":"entity","title":"E"},"body":"# E"}`,
        `{"op":"append_source","path":"entities/E.md","source":{"account":"A","article_id":"a1","quoted":"q"}}`,
      ].join("\n"),
      meta: { cli: "claude", model: "opus", durationMs: 10 },
    });
    const agent = new WikiIngestorAgent({ cli: "claude", model: "opus" });
    const out = await agent.ingest({
      account: "A",
      batchIndex: 0,
      totalBatches: 1,
      articles: [{ id: "a1", title: "t", published_at: "2026-01-01", body_plain: "hello", images: [] }],
      existingPages: [{ path: "entities/E.md", frontmatter: { type: "entity", title: "E", sources: [], last_ingest: "" }, first_chars: "old" }],
      indexMd: "# index",
      wikiGuide: "GUIDE",
    });
    expect(out.ops).toHaveLength(2);
    expect(out.ops[0]!.op).toBe("upsert");
    expect(mockInvoke).toHaveBeenCalledOnce();
    const call = mockInvoke.mock.calls[0]![0];
    expect(call.userMessage).toContain("GUIDE");
    expect(call.userMessage).toContain("a1");
    expect(call.userMessage).toContain("entities/E.md");
    expect(call.agentKey).toBe("wiki.ingestor");
  });

  it("skips malformed NDJSON lines", async () => {
    mockInvoke.mockReturnValue({
      text: [
        `not json`,
        `{"op":"note","body":"ok"}`,
        `{broken`,
        `{"op":"upsert","path":"entities/X.md","frontmatter":{"type":"entity","title":"X"},"body":"x"}`,
      ].join("\n"),
      meta: { cli: "claude", durationMs: 1 },
    });
    const agent = new WikiIngestorAgent({ cli: "claude" });
    const out = await agent.ingest({
      account: "A", batchIndex: 0, totalBatches: 1,
      articles: [], existingPages: [], indexMd: "", wikiGuide: "",
    });
    expect(out.ops.map((o) => o.op)).toEqual(["note", "upsert"]);
  });

  it("strips fence around NDJSON", async () => {
    mockInvoke.mockReturnValue({
      text: "```ndjson\n" + `{"op":"note","body":"x"}` + "\n```",
      meta: { cli: "claude", durationMs: 1 },
    });
    const agent = new WikiIngestorAgent({ cli: "claude" });
    const out = await agent.ingest({
      account: "A", batchIndex: 0, totalBatches: 1,
      articles: [], existingPages: [], indexMd: "", wikiGuide: "",
    });
    expect(out.ops).toHaveLength(1);
  });
});

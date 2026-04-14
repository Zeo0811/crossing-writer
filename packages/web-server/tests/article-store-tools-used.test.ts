import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArticleStore } from "../src/services/article-store.js";

describe("ArticleStore.writeSection tools_used passthrough", () => {
  let dir: string;
  let store: ArticleStore;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "as-tools-"));
    store = new ArticleStore(dir);
    await store.init();
  });

  it("round-trips tools_used in frontmatter", async () => {
    const usage = [
      {
        tool: "search_raw",
        query: "hello",
        args: { kind: "article" },
        pinned_by: "auto",
        round: 1,
        hits_count: 3,
        hits_summary: [{ path: "a.md", title: "A", score: 0.9 }],
      },
    ];
    await store.writeSection("opening", {
      key: "opening",
      frontmatter: {
        section: "opening",
        last_agent: "writer.opening",
        last_updated_at: "2026-04-14T00:00:00Z",
        tools_used: usage,
      } as any,
      body: "开场正文",
    });

    const read = await store.readSection("opening");
    expect(read).toBeTruthy();
    expect((read!.frontmatter as any).tools_used).toEqual(usage);
    expect(read!.frontmatter.last_agent).toBe("writer.opening");
    expect(read!.body).toBe("开场正文");
  });
});

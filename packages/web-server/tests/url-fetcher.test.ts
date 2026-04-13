import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchUrlToMarkdown } from "../src/services/url-fetcher.js";

const originalFetch = global.fetch;
beforeEach(() => {
  global.fetch = vi.fn() as any;
});

describe("fetchUrlToMarkdown", () => {
  it("extracts main content with readability", async () => {
    const html = `<!doctype html><html><head><title>Demo</title></head><body>
      <article><h1>Title</h1><p>This is the main content paragraph that is long enough for readability library to recognize as the primary article body of the page, and it should be extracted cleanly.</p></article>
    </body></html>`;
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => html,
    } as any);
    const md = await fetchUrlToMarkdown("https://example.com/a");
    expect(md).toMatch(/main content/);
  });

  it("throws on 404", async () => {
    vi.mocked(global.fetch).mockResolvedValue({ ok: false, status: 404, text: async () => "" } as any);
    await expect(fetchUrlToMarkdown("https://example.com/x")).rejects.toThrow(/404/);
  });

  it("returns empty string when readability finds nothing", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true, status: 200, text: async () => "<html><head><title>empty</title></head><body></body></html>",
    } as any);
    const md = await fetchUrlToMarkdown("https://example.com/empty");
    expect(md.trim()).toBe("");
  });

  it("prefixes title as H1 when present", async () => {
    const html = `<!doctype html><html><head><title>My Title</title></head><body>
      <article><p>This long enough main paragraph serves as the article body for readability extraction testing with plenty of words so the readability heuristic catches it.</p></article>
    </body></html>`;
    vi.mocked(global.fetch).mockResolvedValue({ ok: true, status: 200, text: async () => html } as any);
    const md = await fetchUrlToMarkdown("https://example.com/t");
    expect(md).toMatch(/^#\s/);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getSections, putSection, startWriter, listStylePanels,
} from "../../src/api/writer-client";

describe("writer-client", () => {
  const origFetch = global.fetch;
  beforeEach(() => {
    (global as any).fetch = vi.fn();
  });
  afterEach(() => { (global as any).fetch = origFetch; });

  it("getSections returns parsed body on 200", async () => {
    (global.fetch as any).mockResolvedValue({ ok: true, status: 200, json: async () => ({ sections: [{ key: "opening", frontmatter: {}, preview: "p" }] }) });
    const out = await getSections("pid");
    expect(out.sections[0].key).toBe("opening");
  });

  it("putSection POSTs body and throws on non-2xx", async () => {
    (global.fetch as any).mockResolvedValue({ ok: false, status: 400, text: async () => "bad" });
    await expect(putSection("pid", "opening", "new")).rejects.toThrow(/400/);
  });

  it("startWriter posts config body", async () => {
    (global.fetch as any).mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    await startWriter("pid", { cli_model_per_agent: { "writer.opening": { cli: "claude", model: "opus" } } });
    const call = (global.fetch as any).mock.calls[0];
    expect(call[0]).toContain("/writer/start");
    expect(JSON.parse(call[1].body).cli_model_per_agent["writer.opening"].cli).toBe("claude");
  });

  it("listStylePanels returns array", async () => {
    (global.fetch as any).mockResolvedValue({ ok: true, status: 200, json: async () => [{ id: "赛博禅心", path: "/p", last_updated_at: "t" }] });
    const out = await listStylePanels();
    expect(out[0].id).toBe("赛博禅心");
  });
});

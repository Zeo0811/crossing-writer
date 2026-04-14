import { describe, it, expect, vi, beforeEach } from "vitest";
import { uploadImage } from "../../src/api/writer-client";

describe("writer-client uploadImage (SP-13)", () => {
  beforeEach(() => {
    (globalThis as any).fetch = vi.fn();
  });

  it("POSTs multipart/form-data to /api/projects/:id/images with field file", async () => {
    (globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ url: "/api/projects/p1/images/abc.png", filename: "abc.png", bytes: 3, mime: "image/png" }),
    });
    const file = new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" });
    const res = await uploadImage("p1", file);
    expect(res.url).toBe("/api/projects/p1/images/abc.png");
    const call = (globalThis.fetch as any).mock.calls[0]!;
    expect(call[0]).toBe("/api/projects/p1/images");
    expect(call[1].method).toBe("POST");
    const fd = call[1].body as FormData;
    expect(fd instanceof FormData).toBe(true);
    expect(fd.get("file")).toBe(file);
  });

  it("throws on non-2xx response", async () => {
    (globalThis.fetch as any).mockResolvedValue({ ok: false, status: 413, text: async () => "too large" });
    await expect(uploadImage("p1", new File([new Uint8Array([1])], "x.png", { type: "image/png" }))).rejects.toThrow(/413/);
  });
});

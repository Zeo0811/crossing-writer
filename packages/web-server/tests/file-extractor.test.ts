import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { extractToMarkdown } from "../src/services/file-extractor.js";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

vi.mock("mammoth", () => {
  const convertToMarkdown = vi.fn(async () => ({ value: "# docx content\n\nhello" }));
  return {
    default: { convertToMarkdown },
    convertToMarkdown,
  };
});

vi.mock("pdf-parse", () => ({
  default: vi.fn(async () => ({ text: "pdf content\n\nmore text" })),
}));

describe("extractToMarkdown", () => {
  it("passes through md files", async () => {
    const buf = readFileSync(join(FIX, "sample.md"));
    const md = await extractToMarkdown(buf, "sample.md");
    expect(md).toMatch(/Hello from markdown/);
  });

  it("passes through .markdown files", async () => {
    const md = await extractToMarkdown(Buffer.from("# raw md"), "x.markdown");
    expect(md).toBe("# raw md");
  });

  it("wraps txt in text content", async () => {
    const buf = readFileSync(join(FIX, "sample.txt"));
    const md = await extractToMarkdown(buf, "sample.txt");
    expect(md).toMatch(/Plain text content for testing/);
  });

  it("extracts docx via mammoth", async () => {
    const md = await extractToMarkdown(Buffer.from("fake"), "brief.docx");
    expect(md).toMatch(/docx content/);
  });

  it("extracts pdf via pdf-parse", async () => {
    const md = await extractToMarkdown(Buffer.from("fake"), "brief.pdf");
    expect(md).toMatch(/pdf content/);
  });

  it("throws on unsupported extension", async () => {
    await expect(extractToMarkdown(Buffer.from(""), "bad.jpg")).rejects.toThrow(/unsupported/i);
  });

  it("is case-insensitive on extension", async () => {
    const md = await extractToMarkdown(Buffer.from("x"), "BRIEF.DOCX");
    expect(md).toMatch(/docx content/);
  });
});

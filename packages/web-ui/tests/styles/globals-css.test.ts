import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(resolve(__dirname, "../../src/styles/globals.css"), "utf8");

describe("globals.css T23 cleanup", () => {
  it("does not contain legacy .modal-old / .btn-old / .panel-old rules", () => {
    expect(css).not.toMatch(/\.modal-old/);
    expect(css).not.toMatch(/\.btn-old/);
    expect(css).not.toMatch(/\.panel-old/);
  });

  it("body uses token-based background + color", () => {
    expect(css).toMatch(/body\s*\{[^}]*background:\s*var\(--bg-0\)/);
    expect(css).toMatch(/body\s*\{[^}]*color:\s*var\(--body\)/);
  });

  it("declares @theme font utilities", () => {
    expect(css).toMatch(/--font-pixel/);
    expect(css).toMatch(/--font-sans/);
    expect(css).toMatch(/--font-mono-term/);
  });

  it("does not reference legacy hex #f0f2f5 / #1a1a1a", () => {
    expect(css).not.toMatch(/#f0f2f5/);
    expect(css).not.toMatch(/#1a1a1a/);
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const html = readFileSync(resolve(__dirname, "../../index.html"), "utf8");
const css = readFileSync(resolve(__dirname, "../../src/styles/globals.css"), "utf8");

describe("fonts", () => {
  it("index.html links Google Fonts with all five families", () => {
    expect(html).toContain("fonts.googleapis.com");
    expect(html).toMatch(/Press\+Start\+2P/);
    expect(html).toMatch(/VT323/);
    expect(html).toMatch(/Inter:wght@400;500;600/);
    expect(html).toMatch(/IBM\+Plex\+Mono/);
    expect(html).toMatch(/Noto\+Sans\+SC/);
  });

  it("globals.css exposes font utility classes via @theme", () => {
    expect(css).toMatch(/--font-pixel/);
    expect(css).toMatch(/--font-sans/);
    expect(css).toMatch(/--font-mono-term/);
  });
});

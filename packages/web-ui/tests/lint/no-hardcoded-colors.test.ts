import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, relative } from "node:path";

// Walk src/ collecting all .ts/.tsx files, excluding the tokens file + pixel icon SVGs.
const SRC = resolve(__dirname, "../../src");
const EXCLUDE_FILES = new Set<string>([
  "styles/tokens.css",
]);
const EXCLUDE_DIRS = new Set<string>([
  "components/icons", // pixel SVG icons allowed to keep structural fills
]);

function walk(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

function rel(p: string) {
  return relative(SRC, p).replaceAll("\\", "/");
}

const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;

describe("no-hardcoded-colors (T22)", () => {
  it("reports count of files still containing hex literals (excluding tokens + icons)", () => {
    const files = walk(SRC).filter((f) => {
      const r = rel(f);
      if (EXCLUDE_FILES.has(r)) return false;
      for (const dir of EXCLUDE_DIRS) if (r.startsWith(dir)) return false;
      return true;
    });
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (HEX_RE.test(src)) offenders.push(rel(f));
    }
    // T22 swept all known offenders; acceptable count: 0.
    expect(offenders).toEqual([]);
  });
});

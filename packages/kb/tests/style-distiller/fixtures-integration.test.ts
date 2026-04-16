import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitParagraphs } from '../../src/style-distiller/paragraph-splitter.js';

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(THIS_DIR, '../fixtures/style-distill-v2');

function stripFrontmatter(raw: string): string {
  const m = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return m ? raw.slice(m[0].length) : raw;
}

describe('fixtures paragraph split sanity', () => {
  const files = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.md'));

  it('has at least 5 fixture articles', () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
  });

  for (const file of files) {
    it(`${file}: yields reasonable paragraph count`, () => {
      const raw = readFileSync(join(FIXTURES_DIR, file), 'utf-8');
      const body = stripFrontmatter(raw);
      const paragraphs = splitParagraphs(body);
      expect(paragraphs.length).toBeGreaterThan(5);
      expect(paragraphs.length).toBeLessThan(500);
    });

    it(`${file}: compresses images to [図] when images are present in source`, () => {
      const raw = readFileSync(join(FIXTURES_DIR, file), 'utf-8');
      const body = stripFrontmatter(raw);
      const sourceHasImages = /^!\[[^\]]*\]\([^)]+\)\s*$/m.test(body);
      if (!sourceHasImages) return;
      const paragraphs = splitParagraphs(body);
      expect(paragraphs).toContain('[图]');
    });

    it(`${file}: treats H1/H2 headings as their own paragraph`, () => {
      const raw = readFileSync(join(FIXTURES_DIR, file), 'utf-8');
      const body = stripFrontmatter(raw);
      const paragraphs = splitParagraphs(body);
      // if source has any "## " or "### " line, at least one paragraph should start with "#"
      const hasHeading = /^#{1,6}\s/m.test(body);
      if (hasHeading) {
        expect(paragraphs.some((p) => /^#{1,6}\s/.test(p))).toBe(true);
      }
    });
  }
});

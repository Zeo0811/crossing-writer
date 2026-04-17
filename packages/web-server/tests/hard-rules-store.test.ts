import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HardRulesStore } from '../src/services/hard-rules-store.js';

describe('HardRulesStore', () => {
  let tmp: string;
  let store: HardRulesStore;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'crx-hardrules-'));
    store = new HardRulesStore(tmp);
  });

  it('seeds a default file if not present', async () => {
    const rules = await store.read();
    expect(rules.version).toBe(1);
    expect(rules.banned_phrases.length).toBeGreaterThan(0);
    expect(existsSync(join(tmp, 'writing-hard-rules.yaml'))).toBe(true);
  });

  it('reads existing yaml without overwriting', async () => {
    await store.write({
      version: 1,
      updated_at: '2026-04-16T00:00:00Z',
      banned_phrases: [{ pattern: 'X', is_regex: false, reason: 'r' }],
      banned_vocabulary: [],
      layout_rules: ['段落 ≤ 80 字'],
    });
    const rules = await store.read();
    expect(rules.banned_phrases).toHaveLength(1);
    expect(rules.banned_phrases[0]!.pattern).toBe('X');
    expect(rules.layout_rules).toEqual(['段落 ≤ 80 字']);
  });

  it('write is atomic: file ends up with expected content', async () => {
    await store.write({
      version: 1,
      updated_at: '2026-04-16T00:00:00Z',
      banned_phrases: [],
      banned_vocabulary: [],
      layout_rules: [],
    });
    const raw = readFileSync(join(tmp, 'writing-hard-rules.yaml'), 'utf-8');
    expect(raw).toContain('version: 1');
    // Should not leave any .tmp.* stragglers in the dir
    const { readdirSync } = await import('node:fs');
    const leftover = readdirSync(tmp).filter(f => f.includes('.tmp.'));
    expect(leftover).toEqual([]);
  });

  it('throws if existing yaml has unexpected version', async () => {
    const { writeFileSync, mkdirSync } = await import('node:fs');
    mkdirSync(tmp, { recursive: true });
    writeFileSync(join(tmp, 'writing-hard-rules.yaml'), 'version: 2\n', 'utf-8');
    await expect(store.read()).rejects.toThrow(/version/);
  });

  it('seed includes default word_count_overrides', async () => {
    const rules = await store.read();
    expect(rules.word_count_overrides).toBeDefined();
    expect(rules.word_count_overrides?.opening).toEqual([200, 400]);
    expect(rules.word_count_overrides?.closing).toEqual([200, 350]);
    expect(rules.word_count_overrides?.article).toEqual([3500, 8000]);
  });

  it('round-trips a custom word_count_overrides', async () => {
    await store.write({
      version: 1,
      updated_at: '2026-04-17T00:00:00Z',
      banned_phrases: [],
      banned_vocabulary: [],
      layout_rules: [],
      word_count_overrides: {
        opening: [180, 380],
      },
    });
    const rules = await store.read();
    expect(rules.word_count_overrides?.opening).toEqual([180, 380]);
    expect(rules.word_count_overrides?.closing).toBeUndefined();
  });
});

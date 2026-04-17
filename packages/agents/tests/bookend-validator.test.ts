import { describe, it, expect } from 'vitest';
import { countChars, checkWordCount } from '../src/roles/bookend-validator.js';

describe('countChars', () => {
  it('counts Chinese + English chars, ignoring whitespace', () => {
    expect(countChars('你好 hello')).toBe(7);
  });

  it('strips markdown bold markers', () => {
    expect(countChars('**核心**观点')).toBe(4);
  });

  it('strips markdown headings', () => {
    expect(countChars('# 标题\n正文')).toBe(4);
  });

  it('strips code fences and inline backticks', () => {
    expect(countChars('`code` 正文')).toBe(6);
  });

  it('strips list bullets', () => {
    expect(countChars('- 项目一\n- 项目二')).toBe(6);
  });

  it('counts empty string as 0', () => {
    expect(countChars('')).toBe(0);
  });
});

describe('checkWordCount', () => {
  it('returns null when override missing', () => {
    expect(checkWordCount('正文', undefined)).toBeNull();
  });

  it('returns null when chars within tolerance band', () => {
    // range [200, 350], tolerance band [160, 420]
    const text = '字'.repeat(300);
    expect(checkWordCount(text, [200, 350])).toBeNull();
  });

  it('returns null when chars equal upper tolerance bound (420)', () => {
    const text = '字'.repeat(420);
    expect(checkWordCount(text, [200, 350])).toBeNull();
  });

  it('returns violation when chars > ceil(max * 1.2)', () => {
    // range [200, 350], tolerance max = ceil(350*1.2) = 420
    const text = '字'.repeat(421);
    const v = checkWordCount(text, [200, 350]);
    expect(v).toEqual({
      kind: 'word_count',
      chars: 421,
      min: 200,
      max: 350,
      tolerance: 0.2,
    });
  });

  it('returns violation when chars < floor(min * 0.8)', () => {
    // range [200, 350], tolerance min = floor(200*0.8) = 160
    const text = '字'.repeat(159);
    const v = checkWordCount(text, [200, 350]);
    expect(v).toEqual({
      kind: 'word_count',
      chars: 159,
      min: 200,
      max: 350,
      tolerance: 0.2,
    });
  });
});

import { findBannedPhrases, findBannedVocabulary } from '../src/roles/bookend-validator.js';

describe('findBannedPhrases', () => {
  it('matches literal phrase', () => {
    const hits = findBannedPhrases('这句有正如所见的翻译腔', [
      { pattern: '正如所见', is_regex: false, reason: '翻译腔' },
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      kind: 'banned_phrase',
      pattern: '正如所见',
      reason: '翻译腔',
    });
    expect(hits[0]!.excerpt).toContain('正如所见');
  });

  it('matches regex phrase', () => {
    const hits = findBannedPhrases('这不是工具而是伙伴', [
      { pattern: '不是.+?而是', is_regex: true, reason: '烂大街' },
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.pattern).toBe('不是.+?而是');
  });

  it('returns empty when no hit', () => {
    expect(findBannedPhrases('一段干净的文字', [
      { pattern: '不是.+?而是', is_regex: true, reason: 'x' },
    ])).toHaveLength(0);
  });

  it('skips regex that fails to compile (no throw)', () => {
    const hits = findBannedPhrases('任意文字', [
      { pattern: '[unclosed', is_regex: true, reason: 'x' },
      { pattern: '文字', is_regex: false, reason: 'y' },
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.pattern).toBe('文字');
  });

  it('returns multiple hits for multiple phrases', () => {
    const hits = findBannedPhrases('不是A而是B。另外还有正如所见。', [
      { pattern: '不是.+?而是', is_regex: true, reason: '1' },
      { pattern: '正如所见', is_regex: false, reason: '2' },
    ]);
    expect(hits).toHaveLength(2);
  });
});

describe('findBannedVocabulary', () => {
  it('matches word via includes', () => {
    const hits = findBannedVocabulary('笔者认为值得一试', [
      { word: '笔者', reason: '第三人称自称不自然' },
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toEqual({
      kind: 'banned_vocabulary',
      word: '笔者',
      reason: '第三人称自称不自然',
    });
  });

  it('returns empty when no hit', () => {
    expect(findBannedVocabulary('我认为', [
      { word: '笔者', reason: 'x' },
    ])).toHaveLength(0);
  });

  it('returns multiple hits for multiple words', () => {
    const hits = findBannedVocabulary('笔者和本人都这么想', [
      { word: '笔者', reason: '1' },
      { word: '本人', reason: '2' },
    ]);
    expect(hits).toHaveLength(2);
  });
});

import { validateBookend } from '../src/roles/bookend-validator.js';
import type { WritingHardRules } from '../src/roles/writer-shared.js';

const CLEAN_RULES: WritingHardRules = {
  version: 1,
  updated_at: '2026-04-17T00:00:00Z',
  banned_phrases: [
    { pattern: '不是.+?而是', is_regex: true, reason: '烂大街' },
  ],
  banned_vocabulary: [{ word: '笔者', reason: 'x' }],
  layout_rules: [],
  word_count_overrides: { opening: [200, 400], closing: [200, 350] },
};

describe('validateBookend', () => {
  it('passes when all rules met', () => {
    const text = '字'.repeat(300);
    const r = validateBookend({
      finalText: text,
      role: 'closing',
      hardRules: CLEAN_RULES,
      wordOverride: [200, 350],
    });
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
    expect(r.chars).toBe(300);
  });

  it('collects multiple violations', () => {
    const text = `${'字'.repeat(500)}不是A而是B笔者`;
    const r = validateBookend({
      finalText: text,
      role: 'closing',
      hardRules: CLEAN_RULES,
      wordOverride: [200, 350],
    });
    expect(r.ok).toBe(false);
    const kinds = r.violations.map((v) => v.kind).sort();
    expect(kinds).toEqual([
      'banned_phrase',
      'banned_vocabulary',
      'word_count',
    ]);
  });

  it('word_count skipped when override missing — other checks still run', () => {
    const text = '字'.repeat(5) + '不是A而是B';
    const r = validateBookend({
      finalText: text,
      role: 'closing',
      hardRules: CLEAN_RULES,
      wordOverride: undefined,
    });
    expect(r.ok).toBe(false);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]!.kind).toBe('banned_phrase');
  });

  it('empty rules → all pass', () => {
    const emptyRules: WritingHardRules = {
      version: 1,
      updated_at: '',
      banned_phrases: [],
      banned_vocabulary: [],
      layout_rules: [],
    };
    const r = validateBookend({
      finalText: '任意文字',
      role: 'opening',
      hardRules: emptyRules,
      wordOverride: undefined,
    });
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it('undercount violation', () => {
    // range [200, 400], lowerBound = floor(200*0.8) = 160
    const text = '字'.repeat(100);
    const r = validateBookend({
      finalText: text,
      role: 'opening',
      hardRules: CLEAN_RULES,
      wordOverride: [200, 400],
    });
    expect(r.ok).toBe(false);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]!.kind).toBe('word_count');
  });
});

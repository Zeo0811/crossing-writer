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

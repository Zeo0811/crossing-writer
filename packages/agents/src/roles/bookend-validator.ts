import type { WritingHardRules } from './writer-shared.js';

export type Violation =
  | { kind: 'word_count'; chars: number; min: number; max: number; tolerance: 0.2 }
  | { kind: 'banned_phrase'; pattern: string; reason: string; excerpt: string }
  | { kind: 'banned_vocabulary'; word: string; reason: string };

export interface ValidationResult {
  ok: boolean;
  violations: Violation[];
  chars: number;
}

/**
 * Count body chars: strip markdown markers (**, #, backticks, list bullets)
 * + strip whitespace; count what's left.
 */
export function countChars(text: string): number {
  let s = text;
  // Strip code fences (``` blocks) entirely
  s = s.replace(/```[\s\S]*?```/g, '');
  // Strip inline backticks but keep their content
  s = s.replace(/`([^`]*)`/g, '$1');
  // Strip bold / italic markers
  s = s.replace(/\*+/g, '');
  s = s.replace(/_+/g, '');
  // Strip heading hashes at line start
  s = s.replace(/^#+\s*/gm, '');
  // Strip list bullets at line start
  s = s.replace(/^[\s]*[-*+]\s+/gm, '');
  s = s.replace(/^[\s]*\d+\.\s+/gm, '');
  // Strip blockquote markers
  s = s.replace(/^>\s*/gm, '');
  // Strip all whitespace (incl. newlines, full-width spaces)
  s = s.replace(/[\s\u3000]+/g, '');
  return s.length;
}

/**
 * Check total word count against override. Returns null if override missing
 * OR chars within tolerance band [floor(min*0.8), ceil(max*1.2)].
 */
export function checkWordCount(
  text: string,
  override: [number, number] | undefined,
): Extract<Violation, { kind: 'word_count' }> | null {
  if (!override) return null;
  const [min, max] = override;
  const lowerBound = Math.floor(min * 0.8);
  const upperBound = Math.ceil(max * 1.2);
  const chars = countChars(text);
  if (chars >= lowerBound && chars <= upperBound) return null;
  return {
    kind: 'word_count',
    chars,
    min,
    max,
    tolerance: 0.2,
  };
}

/** Snippet of surrounding text for a phrase hit — makes violation feedback useful */
function extractExcerpt(text: string, matchIndex: number, matchLen: number, ctx = 15): string {
  const start = Math.max(0, matchIndex - ctx);
  const end = Math.min(text.length, matchIndex + matchLen + ctx);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

export interface BannedPhraseRule {
  pattern: string;
  is_regex: boolean;
  reason: string;
}
export interface BannedVocabRule {
  word: string;
  reason: string;
}

export function findBannedPhrases(
  text: string,
  phrases: BannedPhraseRule[],
): Array<Extract<Violation, { kind: 'banned_phrase' }>> {
  const hits: Array<Extract<Violation, { kind: 'banned_phrase' }>> = [];
  for (const p of phrases) {
    if (p.is_regex) {
      let re: RegExp;
      try {
        re = new RegExp(p.pattern, 'u');
      } catch {
        continue;
      }
      const m = text.match(re);
      if (m && m.index !== undefined) {
        hits.push({
          kind: 'banned_phrase',
          pattern: p.pattern,
          reason: p.reason,
          excerpt: extractExcerpt(text, m.index, m[0].length),
        });
      }
    } else {
      const idx = text.indexOf(p.pattern);
      if (idx !== -1) {
        hits.push({
          kind: 'banned_phrase',
          pattern: p.pattern,
          reason: p.reason,
          excerpt: extractExcerpt(text, idx, p.pattern.length),
        });
      }
    }
  }
  return hits;
}

export function findBannedVocabulary(
  text: string,
  vocab: BannedVocabRule[],
): Array<Extract<Violation, { kind: 'banned_vocabulary' }>> {
  const hits: Array<Extract<Violation, { kind: 'banned_vocabulary' }>> = [];
  for (const v of vocab) {
    if (text.includes(v.word)) {
      hits.push({
        kind: 'banned_vocabulary',
        word: v.word,
        reason: v.reason,
      });
    }
  }
  return hits;
}

export interface ValidateBookendOpts {
  finalText: string;
  role: 'opening' | 'closing';
  hardRules: WritingHardRules;
  wordOverride?: [number, number];
}

export function validateBookend(opts: ValidateBookendOpts): ValidationResult {
  const violations: Violation[] = [];
  const chars = countChars(opts.finalText);

  const wordViolation = checkWordCount(opts.finalText, opts.wordOverride);
  if (wordViolation) violations.push(wordViolation);

  for (const v of findBannedPhrases(opts.finalText, opts.hardRules.banned_phrases)) {
    violations.push(v);
  }
  for (const v of findBannedVocabulary(opts.finalText, opts.hardRules.banned_vocabulary)) {
    violations.push(v);
  }

  return {
    ok: violations.length === 0,
    violations,
    chars,
  };
}

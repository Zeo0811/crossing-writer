import type { ArticleSample, QuantResult } from "./types.js";

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;
const TRANSITION_WORDS = ["首先", "其次", "然后", "最后", "但是", "然而", "不过", "所以", "因此", "另外", "此外", "值得一提的是", "有意思的是", "说回来", "不止如此", "同时", "与此同时", "回到"];
const WE_RE = /我们/g;
const YOU_RE = /你(?!好)/g;

function dist(values: number[]): { median: number; p10: number; p90: number } {
  if (values.length === 0) return { median: 0, p10: 0, p90: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (p: number) => {
    const idx = p * (sorted.length - 1);
    const lower = Math.floor(idx);
    const upper = Math.ceil(idx);
    const w = idx - lower;
    return sorted[lower]! * (1 - w) + sorted[upper]! * w;
  };
  return { median: pick(0.5), p10: pick(0.1), p90: pick(0.9) };
}

function splitSections(body: string): string[] {
  const parts = body.split(/^##\s+.+$/m);
  return parts.filter((p) => p.trim().length > 0);
}

function splitParagraphs(body: string): string[] {
  return body.split(/\n\n+/).filter((p) => p.trim().length > 0);
}

function countSentences(paragraph: string): number {
  const m = paragraph.match(/[。！？!?]/g);
  return Math.max(1, m ? m.length : 1);
}

export function analyzeQuant(account: string, samples: ArticleSample[]): QuantResult {
  if (samples.length === 0) {
    throw new Error("analyzeQuant: empty samples");
  }
  const wordCounts: number[] = [];
  const openingWords: number[] = [];
  const closingWords: number[] = [];
  const caseSectionWords: number[] = [];
  const paragraphLens: number[] = [];
  const boldPerSection: number[] = [];
  const emojiCounts: Record<string, number> = {};
  let totalChars = 0;
  let totalImages = 0;
  let weHits = 0;
  let youHits = 0;
  let articlesWithPronoun = 0;
  let articlesTotal = 0;
  const transitionCounts: Record<string, number> = {};
  let dateMin = samples[0]!.published_at;
  let dateMax = samples[0]!.published_at;

  for (const s of samples) {
    articlesTotal += 1;
    wordCounts.push(s.word_count);
    if (s.published_at < dateMin) dateMin = s.published_at;
    if (s.published_at > dateMax) dateMax = s.published_at;

    const paragraphs = splitParagraphs(s.body_plain);
    if (paragraphs.length > 0) {
      openingWords.push(paragraphs[0]!.length);
      closingWords.push(paragraphs[paragraphs.length - 1]!.length);
    }
    for (const p of paragraphs) paragraphLens.push(countSentences(p));

    const sections = splitSections(s.body_plain);
    for (const sec of sections) {
      caseSectionWords.push(sec.length);
      const bolds = sec.match(/\*\*.+?\*\*/g);
      boldPerSection.push(bolds ? bolds.length : 0);
    }

    const emojiMatches = s.body_plain.match(EMOJI_RE) ?? [];
    for (const e of emojiMatches) emojiCounts[e] = (emojiCounts[e] ?? 0) + 1;

    totalChars += s.body_plain.length;
    const imgs = s.body_plain.match(/!\[[^\]]*\]\([^)]*\)/g);
    totalImages += imgs ? imgs.length : 0;

    const we = (s.body_plain.match(WE_RE) ?? []).length;
    const you = (s.body_plain.match(YOU_RE) ?? []).length;
    weHits += we;
    youHits += you;
    if (we > 0 || you > 0) articlesWithPronoun += 1;

    for (const w of TRANSITION_WORDS) {
      const re = new RegExp(w, "g");
      const m = s.body_plain.match(re);
      if (m) transitionCounts[w] = (transitionCounts[w] ?? 0) + m.length;
    }
  }

  const emoji_density: Record<string, number> = {};
  for (const [k, v] of Object.entries(emojiCounts)) emoji_density[k] = v / samples.length;

  const totalPronounHits = weHits + youHits;
  const weRatio = totalPronounHits > 0 ? weHits / (totalPronounHits + (articlesTotal - articlesWithPronoun)) : 0;
  const youRatio = totalPronounHits > 0 ? youHits / (totalPronounHits + (articlesTotal - articlesWithPronoun)) : 0;
  const noneRatio = Math.max(0, 1 - weRatio - youRatio);

  const top_transition_words = Object.entries(transitionCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([word, count]) => ({ word, count }));

  return {
    account,
    article_count: samples.length,
    date_range: { start: dateMin, end: dateMax },
    word_count: dist(wordCounts),
    opening_words: dist(openingWords),
    closing_words: dist(closingWords),
    case_section_words: dist(caseSectionWords),
    paragraph_length_sentences: dist(paragraphLens),
    bold_per_section: dist(boldPerSection),
    emoji_density,
    image_to_text_ratio: totalImages > 0 ? totalChars / totalImages : 0,
    pronoun_ratio: { we: weRatio, you: youRatio, none: noneRatio },
    top_transition_words,
  };
}

#!/usr/bin/env node
/**
 * evaluate-panel.ts — read a v2 style panel and print a human-readable summary.
 *
 * Usage:
 *   pnpm exec tsx scripts/evaluate-panel.ts <path-to-panel.md>
 *
 * or from the repo root (with tsx installed):
 *   tsx scripts/evaluate-panel.ts ~/CrossingVault/08_experts/style-panel/账号名/opening-v2.md
 */
import { readFileSync } from 'node:fs';
import { parsePanelV2, extractTypeSection, ARTICLE_TYPES } from '@crossing/kb';

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function truncate(s: string, n: number): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length <= n ? flat : flat.slice(0, n) + '…';
}

function printSection(title: string): void {
  console.log('');
  console.log(`\x1b[1m${title}\x1b[0m`);
  console.log('-'.repeat(Math.max(title.length, 40)));
}

function main(): void {
  const panelPath = process.argv[2];
  if (!panelPath) {
    console.error('Usage: tsx scripts/evaluate-panel.ts <panel.md>');
    process.exit(1);
  }

  let raw: string;
  try {
    raw = readFileSync(panelPath, 'utf-8');
  } catch (err) {
    console.error(`Failed to read ${panelPath}: ${(err as Error).message}`);
    process.exit(1);
  }

  let panel: ReturnType<typeof parsePanelV2>;
  try {
    panel = parsePanelV2(panelPath, raw);
  } catch (err) {
    console.error(`Failed to parse as v2 panel: ${(err as Error).message}`);
    process.exit(2);
  }

  const fm = panel.frontmatter;

  console.log(`\x1b[36m=== ${panelPath} ===\x1b[0m`);
  console.log(`${pad('account:', 24)}${fm.account}`);
  console.log(`${pad('role:', 24)}${fm.role}`);
  console.log(`${pad('version:', 24)}${fm.version}`);
  console.log(`${pad('status:', 24)}${fm.status}`);
  console.log(`${pad('source_article_count:', 24)}${fm.source_article_count}`);
  if (fm.slicer_run_id) {
    console.log(`${pad('slicer_run_id:', 24)}${fm.slicer_run_id}`);
  }

  printSection('types');
  if (fm.types.length === 0) {
    console.log('(none)');
  } else {
    for (const t of fm.types) {
      console.log(`  - ${pad(t.key, 8)}  sample_count=${t.sample_count}`);
    }
  }

  printSection('word_count_ranges');
  console.log(`  ${fm.role}: ${fm.word_count_ranges[fm.role].join(' – ')} 字`);
  console.log(`  article: ${fm.word_count_ranges.article.join(' – ')} 字`);

  printSection('pronoun_policy');
  console.log(`  we_ratio:   ${fm.pronoun_policy.we_ratio}`);
  console.log(`  you_ratio:  ${fm.pronoun_policy.you_ratio}`);
  console.log(`  avoid:      ${fm.pronoun_policy.avoid.join(', ') || '(none)'}`);

  printSection('tone');
  console.log(`  primary:          ${fm.tone.primary}`);
  console.log(`  humor_frequency:  ${fm.tone.humor_frequency}`);
  console.log(`  opinionated:      ${fm.tone.opinionated}`);

  printSection('bold_policy');
  console.log(`  frequency:    ${fm.bold_policy.frequency}`);
  console.log(`  what_to_bold: ${fm.bold_policy.what_to_bold.join(', ')}`);
  console.log(`  dont_bold:    ${fm.bold_policy.dont_bold.join(', ')}`);

  printSection('transition_phrases');
  if (fm.transition_phrases.length === 0) {
    console.log('  (none)');
  } else {
    for (const p of fm.transition_phrases) console.log(`  - ${p}`);
  }

  printSection('data_citation');
  console.log(`  required:         ${fm.data_citation.required}`);
  console.log(`  format_style:     ${fm.data_citation.format_style}`);
  console.log(`  min_per_article:  ${fm.data_citation.min_per_article}`);

  printSection('heading_cadence');
  console.log(`  levels_used:        ${fm.heading_cadence.levels_used.join(', ')}`);
  console.log(`  paragraphs_per_h3:  ${fm.heading_cadence.paragraphs_per_h3.join('–')}`);
  console.log(`  h3_style:           ${fm.heading_cadence.h3_style}`);

  printSection('banned_vocabulary');
  if (fm.banned_vocabulary.length === 0) {
    console.log('  (none)');
  } else {
    for (const w of fm.banned_vocabulary) console.log(`  - ${w}`);
  }

  for (const type of ARTICLE_TYPES) {
    const section = extractTypeSection(panel.body, type);
    if (!section) continue;
    printSection(`body section: ${type}模式`);
    console.log(truncate(section, 400));
  }

  console.log('');
}

main();

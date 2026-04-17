import { describe, it, expect } from 'vitest';
import { runBookendWithValidation } from '../src/services/writer-orchestrator.js';
import type { WritingHardRules } from '@crossing/agents';

const RULES: WritingHardRules = {
  version: 1,
  updated_at: '',
  banned_phrases: [
    { pattern: '不是.+?而是', is_regex: true, reason: '烂大街' },
  ],
  banned_vocabulary: [{ word: '笔者', reason: 'x' }],
  layout_rules: [],
  word_count_overrides: { closing: [200, 350] },
};

function goodText(): string { return '字'.repeat(300); }
function badText(): string { return '字'.repeat(500) + '不是A而是B'; }

type Ev = { type: string; [k: string]: unknown };
type FakeRun = {
  finalText: string;
  toolsUsed: [];
  lastMeta: { cli: 'claude'; durationMs: number };
};
function fakeResult(text: string): FakeRun {
  return { finalText: text, toolsUsed: [], lastMeta: { cli: 'claude', durationMs: 1 } };
}

describe('runBookendWithValidation', () => {
  it('first pass valid → validation_passed attempt=1, single run call', async () => {
    const events: Ev[] = [];
    let runCalls = 0;
    const out = await runBookendWithValidation({
      role: 'closing',
      sectionKey: 'closing',
      publishEvent: async (type, data) => { events.push({ type, ...data }); },
      runBookend: async (_retry) => { runCalls++; return fakeResult(goodText()) as any; },
      hardRules: RULES,
      wordOverride: [200, 350],
    });
    expect(runCalls).toBe(1);
    expect(out.finalText).toBe(goodText());
    expect(events.map((e) => e.type)).toEqual(['writer.validation_passed']);
    expect(events[0]).toMatchObject({ attempt: 1, chars: 300, agent: 'writer.closing' });
  });

  it('first bad → retry → second good: validation_retry then validation_passed attempt=2', async () => {
    const events: Ev[] = [];
    const textsSeenByRun: Array<unknown> = [];
    let runCalls = 0;
    const out = await runBookendWithValidation({
      role: 'closing',
      sectionKey: 'closing',
      publishEvent: async (type, data) => { events.push({ type, ...data }); },
      runBookend: async (retry) => {
        runCalls++;
        textsSeenByRun.push(retry);
        return fakeResult(runCalls === 1 ? badText() : goodText()) as any;
      },
      hardRules: RULES,
      wordOverride: [200, 350],
    });
    expect(runCalls).toBe(2);
    expect(out.finalText).toBe(goodText());
    expect(events.map((e) => e.type)).toEqual([
      'writer.validation_retry',
      'writer.validation_passed',
    ]);
    expect(events[0]).toMatchObject({
      agent: 'writer.closing',
      attempt: 1,
      chars: expect.any(Number),
      violations: expect.any(Array),
    });
    expect(events[1]).toMatchObject({ attempt: 2, agent: 'writer.closing' });
    // retry arg passed to second runBookend call
    expect(textsSeenByRun[0]).toBeUndefined();
    expect(textsSeenByRun[1]).toMatchObject({
      previousText: badText(),
      violationsText: expect.stringContaining('[word_count]'),
    });
  });

  it('both bad → validation_failed, second result persists', async () => {
    const events: Ev[] = [];
    let runCalls = 0;
    const out = await runBookendWithValidation({
      role: 'closing',
      sectionKey: 'closing',
      publishEvent: async (type, data) => { events.push({ type, ...data }); },
      runBookend: async () => { runCalls++; return fakeResult(badText()) as any; },
      hardRules: RULES,
      wordOverride: [200, 350],
    });
    expect(runCalls).toBe(2);
    expect(out.finalText).toBe(badText());
    expect(events.map((e) => e.type)).toEqual([
      'writer.validation_retry',
      'writer.validation_failed',
    ]);
    expect(events[1]).toMatchObject({ agent: 'writer.closing', violations: expect.any(Array) });
  });

  it('null hardRules → skip validation entirely', async () => {
    const events: Ev[] = [];
    let runCalls = 0;
    const out = await runBookendWithValidation({
      role: 'closing',
      sectionKey: 'closing',
      publishEvent: async (type, data) => { events.push({ type, ...data }); },
      runBookend: async () => { runCalls++; return fakeResult(badText()) as any; },
      hardRules: null,
      wordOverride: undefined,
    });
    expect(runCalls).toBe(1);
    expect(out.finalText).toBe(badText());
    expect(events).toEqual([]);
  });
});

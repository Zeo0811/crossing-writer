import { describe, it, expect } from 'vitest';
import { resolveModelForAgent } from '../src/services/model-resolver.js';
import type { DefaultModelConfig } from '../src/config.js';

const DM: DefaultModelConfig = {
  writer: { cli: 'claude', model: 'claude-opus-4-7' },
  other:  { cli: 'claude', model: 'claude-sonnet-4-5' },
};

describe('resolveModelForAgent', () => {
  it('writer.opening → writer', () => {
    expect(resolveModelForAgent('writer.opening', DM)).toEqual(DM.writer);
  });
  it('writer.practice → writer', () => {
    expect(resolveModelForAgent('writer.practice', DM)).toEqual(DM.writer);
  });
  it('writer.closing → writer', () => {
    expect(resolveModelForAgent('writer.closing', DM)).toEqual(DM.writer);
  });
  it('brief_analyst → other', () => {
    expect(resolveModelForAgent('brief_analyst', DM)).toEqual(DM.other);
  });
  it('practice.stitcher (no writer prefix) → other', () => {
    expect(resolveModelForAgent('practice.stitcher', DM)).toEqual(DM.other);
  });
  it('style_distiller.composer → other', () => {
    expect(resolveModelForAgent('style_distiller.composer', DM)).toEqual(DM.other);
  });
  it('style_critic (not writer.*) → other', () => {
    expect(resolveModelForAgent('style_critic', DM)).toEqual(DM.other);
  });
  it('topic_expert.foo → other', () => {
    expect(resolveModelForAgent('topic_expert.foo', DM)).toEqual(DM.other);
  });
  it('returns a fresh object (caller-safe)', () => {
    const r = resolveModelForAgent('writer.opening', DM);
    r.cli = 'codex' as const;
    expect(DM.writer.cli).toBe('claude');
  });
});

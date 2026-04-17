import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HardRulesStore } from '../src/services/hard-rules-store.js';
import { registerWritingHardRulesRoutes } from '../src/routes/config-writing-hard-rules.js';

async function buildApp() {
  const tmp = mkdtempSync(join(tmpdir(), 'crx-hr-routes-'));
  const store = new HardRulesStore(tmp);
  const app = Fastify();
  registerWritingHardRulesRoutes(app, { hardRulesStore: store });
  await app.ready();
  return { app, store, tmp };
}

describe('writing-hard-rules routes', () => {
  it('GET returns seeded defaults', async () => {
    const { app } = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/config/writing-hard-rules' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.version).toBe(1);
    expect(body.banned_phrases.length).toBeGreaterThan(0);
  });

  it('PUT replaces the whole object and GET reads it back', async () => {
    const { app } = await buildApp();
    const put = await app.inject({
      method: 'PUT',
      url: '/api/config/writing-hard-rules',
      payload: {
        version: 1,
        updated_at: '2026-04-16T00:00:00Z',
        banned_phrases: [{ pattern: 'Y', is_regex: false, reason: 'test' }],
        banned_vocabulary: [],
        layout_rules: ['only rule'],
      },
    });
    expect(put.statusCode).toBe(200);
    const get = await app.inject({ method: 'GET', url: '/api/config/writing-hard-rules' });
    const body = get.json();
    expect(body.banned_phrases).toHaveLength(1);
    expect(body.layout_rules).toEqual(['only rule']);
  });

  it('PUT 400 on missing version', async () => {
    const { app } = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/config/writing-hard-rules',
      payload: { foo: 'bar' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('PUT 400 when banned_phrases not an array', async () => {
    const { app } = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/config/writing-hard-rules',
      payload: { version: 1, banned_phrases: 'nope', banned_vocabulary: [], layout_rules: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('PUT accepts word_count_overrides', async () => {
    const { app } = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/config/writing-hard-rules',
      payload: {
        version: 1,
        banned_phrases: [],
        banned_vocabulary: [],
        layout_rules: [],
        word_count_overrides: {
          opening: [180, 380],
          closing: [160, 300],
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const get = await app.inject({ method: 'GET', url: '/api/config/writing-hard-rules' });
    expect(get.json().word_count_overrides.opening).toEqual([180, 380]);
  });

  it('PUT 400 on malformed word_count_overrides', async () => {
    const { app } = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/config/writing-hard-rules',
      payload: {
        version: 1,
        banned_phrases: [],
        banned_vocabulary: [],
        layout_rules: [],
        word_count_overrides: { opening: [180, 'bad'] },
      },
    });
    expect(res.statusCode).toBe(400);
  });
});

import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DistillRunStore } from '../src/services/distill-run-store.js';
import { registerDistillRunsRoutes } from '../src/routes/config-distill-runs.js';

async function buildApp() {
  const tmp = mkdtempSync(join(tmpdir(), 'crx-runs-routes-'));
  const store = new DistillRunStore(tmp);
  const app = Fastify();
  registerDistillRunsRoutes(app, { runStore: store });
  await app.ready();
  return { app, store, tmp };
}

describe('distill-runs routes', () => {
  it('GET /runs?status=active returns only active runs', async () => {
    const { app, store } = await buildApp();
    await store.append('r1', { type: 'distill.started', data: { account: 'acc' } });
    await store.append('r2', { type: 'distill.started', data: { account: 'acc' } });
    await store.append('r2', { type: 'distill.finished', data: {} });
    const res = await app.inject({ method: 'GET', url: '/api/config/style-panels/runs?status=active' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.runs.map((r: any) => r.run_id)).toEqual(['r1']);
  });

  it('GET /runs?status=active returns [] when no active', async () => {
    const { app, store } = await buildApp();
    await store.append('r', { type: 'distill.started', data: {} });
    await store.append('r', { type: 'distill.finished', data: {} });
    const res = await app.inject({ method: 'GET', url: '/api/config/style-panels/runs?status=active' });
    expect(res.json().runs).toEqual([]);
  });

  it('GET /runs/:id/stream replays history and sets event-stream headers', async () => {
    const { app, store } = await buildApp();
    await store.append('rX', { type: 'distill.started', data: {} });
    await store.append('rX', { type: 'sampling.done', data: { actual_count: 10 } });
    const res = await app.inject({
      method: 'GET',
      url: '/api/config/style-panels/runs/rX/stream',
      headers: { Accept: 'text/event-stream' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/event-stream/);
    // inject buffers the hijacked stream in payload
    expect(res.payload).toContain('event: distill.started');
    expect(res.payload).toContain('event: sampling.done');
    expect(res.payload).toContain('actual_count');
  });
});

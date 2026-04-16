import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DistillRunStore } from '../src/services/distill-run-store.js';

describe('DistillRunStore', () => {
  let tmp: string;
  let store: DistillRunStore;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'crx-runs-'));
    store = new DistillRunStore(tmp);
  });

  it('append writes one jsonl line and readAll returns it', async () => {
    await store.append('run-1', { type: 'distill.started', data: { account: 'a', sample_size: 50 } });
    const events = await store.readAll('run-1');
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('distill.started');
    expect(events[0]!.data.account).toBe('a');
    expect(typeof events[0]!.ts).toBe('string');
  });

  it('readAll returns [] for unknown run', async () => {
    const events = await store.readAll('no-such-run');
    expect(events).toEqual([]);
  });

  it('listActive returns runs without a final event', async () => {
    await store.append('run-a', { type: 'distill.started', data: { account: 'acc' } });
    await store.append('run-b', { type: 'distill.started', data: { account: 'acc' } });
    await store.append('run-b', { type: 'distill.finished', data: {} });
    await store.append('run-c', { type: 'distill.started', data: { account: 'acc' } });
    await store.append('run-c', { type: 'distill.failed', data: { error: 'oops' } });
    const active = await store.listActive();
    expect(active.map((r) => r.run_id).sort()).toEqual(['run-a']);
    expect(active[0]!.account).toBe('acc');
    expect(active[0]!.status).toBe('active');
  });

  it('subscribe receives live events after subscription time', async () => {
    const received: any[] = [];
    const unsub = store.subscribe('run-1', (ev) => received.push(ev));
    await store.append('run-1', { type: 'sampling.done', data: { actual_count: 50 } });
    await new Promise((r) => setTimeout(r, 30));
    unsub();
    expect(received.map((e) => e.type)).toEqual(['sampling.done']);
  });

  it('unsubscribe stops receiving events', async () => {
    const received: any[] = [];
    const unsub = store.subscribe('run-1', (ev) => received.push(ev));
    unsub();
    await store.append('run-1', { type: 'sampling.done', data: {} });
    await new Promise((r) => setTimeout(r, 30));
    expect(received).toEqual([]);
  });

  it('multiple subscribers both receive events', async () => {
    const a: any[] = []; const b: any[] = [];
    const unsubA = store.subscribe('run-1', (e) => a.push(e));
    const unsubB = store.subscribe('run-1', (e) => b.push(e));
    await store.append('run-1', { type: 'x', data: {} });
    await new Promise((r) => setTimeout(r, 30));
    unsubA(); unsubB();
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });
});

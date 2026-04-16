import { existsSync, mkdirSync, appendFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';

export interface RunEvent {
  ts: string;
  type: string;
  data: Record<string, unknown>;
}

export interface RunSummary {
  run_id: string;
  account?: string;
  started_at: string;
  status: 'active' | 'finished' | 'failed';
  last_event_type?: string;
}

const FINAL_EVENTS = new Set(['distill.finished', 'distill.failed']);

export class DistillRunStore {
  private emitter = new EventEmitter();

  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
    // Node default is 10 listeners per event. With many concurrent watchers
    // per run, bumping this prevents spurious warnings.
    this.emitter.setMaxListeners(100);
  }

  private runFile(runId: string): string {
    return join(this.dir, `${runId}.jsonl`);
  }

  async append(runId: string, ev: Omit<RunEvent, 'ts'>): Promise<RunEvent> {
    const full: RunEvent = { ts: new Date().toISOString(), ...ev };
    appendFileSync(this.runFile(runId), JSON.stringify(full) + '\n', 'utf-8');
    this.emitter.emit(runId, full);
    return full;
  }

  async readAll(runId: string): Promise<RunEvent[]> {
    if (!existsSync(this.runFile(runId))) return [];
    const raw = readFileSync(this.runFile(runId), 'utf-8');
    return raw.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as RunEvent);
  }

  async listActive(): Promise<RunSummary[]> {
    if (!existsSync(this.dir)) return [];
    const files = readdirSync(this.dir).filter((f) => f.endsWith('.jsonl'));
    const out: RunSummary[] = [];
    for (const f of files) {
      const runId = f.slice(0, -'.jsonl'.length);
      const events = await this.readAll(runId);
      if (events.length === 0) continue;
      const first = events[0]!;
      const last = events[events.length - 1]!;
      if (FINAL_EVENTS.has(last.type)) continue;
      out.push({
        run_id: runId,
        account: (first.data as any)?.account,
        started_at: first.ts,
        status: 'active',
        last_event_type: last.type,
      });
    }
    return out;
  }

  subscribe(runId: string, handler: (ev: RunEvent) => void): () => void {
    this.emitter.on(runId, handler);
    return () => { this.emitter.off(runId, handler); };
  }
}

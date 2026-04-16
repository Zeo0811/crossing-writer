import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerStylePanelsCleanupRoutes } from '../src/routes/config-style-panels-cleanup.js';

async function buildApp() {
  const vault = mkdtempSync(join(tmpdir(), 'crx-clean-'));
  const base = join(vault, '08_experts/style-panel');
  mkdirSync(base, { recursive: true });
  // top-level legacy flat
  writeFileSync(join(base, 'legacyAccount_kb.md'), '# legacy flat\n');
  writeFileSync(join(base, 'plain-legacy.md'), '# other legacy\n');
  // nested account dir with v1 and v2
  const acctDir = join(base, 'acc');
  mkdirSync(acctDir, { recursive: true });
  writeFileSync(join(acctDir, 'opening-v1.md'), '# v1 opening\n');
  writeFileSync(join(acctDir, 'practice-v1.md'), '# v1 practice\n');
  writeFileSync(join(acctDir, 'opening-v2.md'), '# v2 opening\n');

  const app = Fastify();
  registerStylePanelsCleanupRoutes(app, { vaultPath: vault });
  await app.ready();
  return { app, base, vault };
}

describe('POST /api/config/style-panels/cleanup-legacy', () => {
  it('removes *-v1.md from nested dirs and all top-level .md', async () => {
    const { app, base } = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/config/style-panels/cleanup-legacy' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.removed).toHaveLength(4);  // 2 top-level + 2 v1 nested

    expect(existsSync(join(base, 'legacyAccount_kb.md'))).toBe(false);
    expect(existsSync(join(base, 'plain-legacy.md'))).toBe(false);
    expect(existsSync(join(base, 'acc', 'opening-v1.md'))).toBe(false);
    expect(existsSync(join(base, 'acc', 'practice-v1.md'))).toBe(false);

    // v2 still there
    expect(existsSync(join(base, 'acc', 'opening-v2.md'))).toBe(true);
    expect(readdirSync(join(base, 'acc'))).toEqual(['opening-v2.md']);
  });

  it('returns empty list when nothing to clean', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'crx-clean-empty-'));
    mkdirSync(join(vault, '08_experts/style-panel'), { recursive: true });
    const app = Fastify();
    registerStylePanelsCleanupRoutes(app, { vaultPath: vault });
    await app.ready();
    const res = await app.inject({ method: 'POST', url: '/api/config/style-panels/cleanup-legacy' });
    expect(res.statusCode).toBe(200);
    expect(res.json().removed).toEqual([]);
  });

  it('tolerates missing base dir', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'crx-clean-missing-'));
    // do not create 08_experts/style-panel
    const app = Fastify();
    registerStylePanelsCleanupRoutes(app, { vaultPath: vault });
    await app.ready();
    const res = await app.inject({ method: 'POST', url: '/api/config/style-panels/cleanup-legacy' });
    expect(res.statusCode).toBe(200);
    expect(res.json().removed).toEqual([]);
  });
});

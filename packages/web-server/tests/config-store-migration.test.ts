import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadServerConfig } from '../src/config.js';

let tmpDir: string;
let cfgPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'crossing-cfg-'));
  cfgPath = join(tmpDir, 'config.json');
});
afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('loadServerConfig — defaultModel migration', () => {
  it('legacy config without defaultModel → derives from existing agents + writes back', () => {
    writeFileSync(cfgPath, JSON.stringify({
      vaultPath: '/tmp/vault',
      sqlitePath: '/tmp/kb.sqlite',
      modelAdapter: { defaultCli: 'claude', fallbackCli: 'codex' },
      agents: {
        'writer.opening': { cli: 'claude', model: 'claude-opus-4-7' },
        'brief_analyst':  { cli: 'claude', model: 'claude-sonnet-4-5' },
      },
    }, null, 2));

    const cfg = loadServerConfig(cfgPath);
    expect(cfg.defaultModel.writer).toEqual({ cli: 'claude', model: 'claude-opus-4-7' });
    expect(cfg.defaultModel.other).toEqual({ cli: 'claude', model: 'claude-sonnet-4-5' });

    const raw = JSON.parse(readFileSync(cfgPath, 'utf-8'));
    expect(raw.defaultModel.writer.model).toBe('claude-opus-4-7');
    expect(raw.defaultModel.other.model).toBe('claude-sonnet-4-5');
    expect(raw.agents['writer.opening'].model).toBeUndefined();
    expect(raw.agents['brief_analyst'].model).toBeUndefined();
  });

  it('legacy agents with reference_accounts → purged by migration', () => {
    writeFileSync(cfgPath, JSON.stringify({
      vaultPath: '/tmp/vault', sqlitePath: '/tmp/kb.sqlite',
      modelAdapter: { defaultCli: 'claude', fallbackCli: 'codex' },
      agents: {
        'writer.opening': {
          cli: 'claude', model: 'claude-opus-4-7',
          reference_accounts: ['acct1', 'acct2'],
        },
      },
    }, null, 2));

    loadServerConfig(cfgPath);
    const raw = JSON.parse(readFileSync(cfgPath, 'utf-8'));
    expect(raw.agents['writer.opening'].reference_accounts).toBeUndefined();
  });

  it('already-migrated config → idempotent (no file churn beyond first read)', () => {
    writeFileSync(cfgPath, JSON.stringify({
      vaultPath: '/tmp/vault', sqlitePath: '/tmp/kb.sqlite',
      modelAdapter: { defaultCli: 'claude', fallbackCli: 'codex' },
      defaultModel: {
        writer: { cli: 'claude', model: 'claude-opus-4-7' },
        other:  { cli: 'claude', model: 'claude-sonnet-4-5' },
      },
      agents: {},
    }, null, 2));

    loadServerConfig(cfgPath);
    loadServerConfig(cfgPath);
    const raw = JSON.parse(readFileSync(cfgPath, 'utf-8'));
    expect(raw.defaultModel.writer.model).toBe('claude-opus-4-7');
  });

  it('no agents at all → hardcoded safe defaults', () => {
    writeFileSync(cfgPath, JSON.stringify({
      vaultPath: '/tmp/vault', sqlitePath: '/tmp/kb.sqlite',
      modelAdapter: { defaultCli: 'claude', fallbackCli: 'codex' },
      agents: {},
    }, null, 2));
    const cfg = loadServerConfig(cfgPath);
    expect(cfg.defaultModel.writer.cli).toBe('claude');
    expect(cfg.defaultModel.writer.model).toBe('claude-opus-4-7');
    expect(cfg.defaultModel.other.cli).toBe('claude');
    expect(cfg.defaultModel.other.model).toBe('claude-sonnet-4-5');
  });
});

describe('loadServerConfig — handles both flat and nested model shapes', () => {
  it('nested AgentConfigEntry shape → derives flat defaultModel', () => {
    writeFileSync(cfgPath, JSON.stringify({
      vaultPath: '/tmp/vault',
      sqlitePath: '/tmp/kb.sqlite',
      modelAdapter: { defaultCli: 'claude', fallbackCli: 'codex' },
      agents: {
        'writer.opening': {
          agentKey: 'writer.opening',
          model: { cli: 'claude', model: 'claude-opus-4-7' },
        },
        'brief_analyst': {
          agentKey: 'brief_analyst',
          model: { cli: 'claude', model: 'claude-sonnet-4-5' },
        },
      },
    }, null, 2));

    const cfg = loadServerConfig(cfgPath);
    expect(cfg.defaultModel.writer).toEqual({ cli: 'claude', model: 'claude-opus-4-7' });
    expect(cfg.defaultModel.other).toEqual({ cli: 'claude', model: 'claude-sonnet-4-5' });
    // No double-wrapping
    expect(typeof cfg.defaultModel.writer.model).toBe('string');
    expect(typeof cfg.defaultModel.other.model).toBe('string');
  });

  it('mixed shapes — one flat, one nested → both normalized', () => {
    writeFileSync(cfgPath, JSON.stringify({
      vaultPath: '/tmp/vault',
      sqlitePath: '/tmp/kb.sqlite',
      modelAdapter: { defaultCli: 'claude', fallbackCli: 'codex' },
      agents: {
        'writer.opening': { cli: 'claude', model: 'claude-opus-4-7' },
        'brief_analyst':  {
          agentKey: 'brief_analyst',
          model: { cli: 'claude', model: 'claude-sonnet-4-5' },
        },
      },
    }, null, 2));

    const cfg = loadServerConfig(cfgPath);
    expect(cfg.defaultModel.writer).toEqual({ cli: 'claude', model: 'claude-opus-4-7' });
    expect(cfg.defaultModel.other).toEqual({ cli: 'claude', model: 'claude-sonnet-4-5' });
  });

  it('nested shape with different cli in inner vs outer → inner wins', () => {
    // Outer says claude, inner says codex — the inner AgentModelConfig is authoritative
    writeFileSync(cfgPath, JSON.stringify({
      vaultPath: '/tmp/vault',
      sqlitePath: '/tmp/kb.sqlite',
      modelAdapter: { defaultCli: 'claude', fallbackCli: 'codex' },
      agents: {
        'writer.opening': {
          cli: 'claude',
          model: { cli: 'codex', model: 'gpt-5.4' },
        },
      },
    }, null, 2));

    const cfg = loadServerConfig(cfgPath);
    expect(cfg.defaultModel.writer).toEqual({ cli: 'codex', model: 'gpt-5.4' });
  });

  it('missing model entirely → cli-only DefaultModelEntry (no model field)', () => {
    writeFileSync(cfgPath, JSON.stringify({
      vaultPath: '/tmp/vault',
      sqlitePath: '/tmp/kb.sqlite',
      modelAdapter: { defaultCli: 'claude', fallbackCli: 'codex' },
      agents: {
        'writer.opening': { cli: 'claude' },
        'brief_analyst':  { cli: 'codex' },
      },
    }, null, 2));

    const cfg = loadServerConfig(cfgPath);
    expect(cfg.defaultModel.writer).toEqual({ cli: 'claude' });
    expect(cfg.defaultModel.other).toEqual({ cli: 'codex' });
  });
});

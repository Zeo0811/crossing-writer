# SP-C Config Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse per-agent `model` config into global 2-tier (`defaultModel.writer` / `defaultModel.other`), remove `reference_accounts` entirely, and shrink ConfigWorkbench from 4 tabs to 2 with 3 former-tab pages promoted to top-level nav entries.

**Architecture:** ServerConfig gains `defaultModel` with one-shot auto-migration from legacy per-agent models. New pure `resolveModelForAgent(agentKey, defaultModel)` routes `writer.*` → writer, else → other. Writer orchestrator + rewrite route call the resolver. refs plumbing deleted end-to-end (types, stores, route loaders, user-message builders, UI fields). ConfigWorkbench becomes 2 tabs (基础 + 状态); TopNav gets new entries for hard-rules + topic-experts (style-panels route already exists).

**Tech Stack:** TypeScript, vitest, Fastify, React + react-router-dom + @tanstack/react-query, js-yaml for server config (actually JSON for ServerConfig), Tailwind for UI.

---

## File Structure

**Create:**
- `packages/web-server/src/services/model-resolver.ts` — `resolveModelForAgent` pure function
- `packages/web-server/tests/model-resolver.test.ts`
- `packages/web-server/tests/config-store-migration.test.ts` — migration unit tests
- `packages/web-ui/src/components/config/BaseTabPanel.tsx` — new 基础 tab body
- `packages/web-ui/src/components/config/StatusTabPanel.tsx` — new 状态 tab body
- `packages/web-ui/src/components/config/__tests__/BaseTabPanel.test.tsx`
- `packages/web-ui/src/pages/TopicExpertsPage.tsx` — promoted from Tab contents
- `packages/web-ui/src/pages/__tests__/TopicExpertsPage.test.tsx`

**Modify:**
- `packages/web-server/src/config.ts` — `ServerConfig` gains `defaultModel: { writer, other }`; `loadServerConfig` migrates legacy JSON
- `packages/web-server/src/services/config-store.ts` — `AgentConfigPatch` gains `defaultModel?`; `doUpdate` persists
- `packages/web-server/src/services/agent-config-store.ts` — drop `model` from `AgentConfigEntry` required fields; drop validator's model requirement; remove `reference_accounts` handling
- `packages/agents/src/config.ts` — drop `reference_accounts` from `AgentConfig`
- `packages/web-server/src/services/writer-orchestrator.ts` — use resolver; delete `loadReferenceAccountKb`, `refsBlock`, refs args from 4 `buildXxxUserMessage`
- `packages/web-server/src/routes/writer.ts` — delete `loadRefs`, refs usage at rewrite + start endpoints
- `packages/web-server/src/services/config-merger.ts` — merge `defaultModel` in ProjectOverride; stop requiring `model` on AgentConfigEntry
- `packages/web-server/src/services/project-override-store.ts` — `ProjectOverride` type gains `defaultModel?`
- `packages/web-server/src/services/context-bundle-service.ts` — drop refs reads if any
- `packages/web-server/src/routes/config.ts` — GET/PUT `/api/config` returns + accepts `defaultModel`
- `packages/web-ui/src/api/writer-client.ts` — `AgentConfigEntry.model` + `reference_accounts` removed from types; new `getDefaultModel` / `setDefaultModel`
- `packages/web-ui/src/pages/ConfigWorkbench.tsx` — 4 tab → 2 tab (基础 + 状态); render BaseTabPanel + StatusTabPanel
- `packages/web-ui/src/components/layout/TopNav.tsx` — new nav entries for `/writing-hard-rules` + `/topic-experts`
- `packages/web-ui/src/App.tsx` — register `/topic-experts` route
- `packages/web-server/tests/config-merger.test.ts` — cover defaultModel merge path
- `packages/web-server/tests/writer-orchestrator*.test.ts` — remove refs expectations; add resolver assertions

**Delete:**
- `packages/web-ui/src/components/config/AgentCard.tsx` + `__tests__/AgentCard.test.tsx`
- `packages/web-ui/src/components/config/AgentsPanel.tsx` + `__tests__/AgentsPanel.test.tsx`
- `packages/web-server/src/services/project-checklist-service.ts` usages of refs (file stays but refs code out)

---

## Task 1: Types — `ServerConfig.defaultModel` + legacy migration

**Files:**
- Modify: `packages/web-server/src/config.ts`
- Create: `packages/web-server/tests/config-store-migration.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/web-server/tests/config-store-migration.test.ts`:

```ts
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
        'writer.opening': { cli: 'claude', model: 'claude-opus-4-6' },
        'brief_analyst':  { cli: 'claude', model: 'claude-sonnet-4-5' },
      },
    }, null, 2));

    const cfg = loadServerConfig(cfgPath);
    expect(cfg.defaultModel.writer).toEqual({ cli: 'claude', model: 'claude-opus-4-6' });
    expect(cfg.defaultModel.other).toEqual({ cli: 'claude', model: 'claude-sonnet-4-5' });

    // Migration writes back: reloaded raw JSON now has defaultModel, agents lost `model`
    const raw = JSON.parse(readFileSync(cfgPath, 'utf-8'));
    expect(raw.defaultModel.writer.model).toBe('claude-opus-4-6');
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
          cli: 'claude', model: 'claude-opus-4-6',
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
        writer: { cli: 'claude', model: 'claude-opus-4-6' },
        other:  { cli: 'claude', model: 'claude-sonnet-4-5' },
      },
      agents: {},
    }, null, 2));

    const beforeMtime = Date.now() - 1000;
    loadServerConfig(cfgPath);
    loadServerConfig(cfgPath);
    // Second load should not alter file content beyond what the first write produced.
    const raw = JSON.parse(readFileSync(cfgPath, 'utf-8'));
    expect(raw.defaultModel.writer.model).toBe('claude-opus-4-6');
  });

  it('no agents at all → hardcoded safe defaults', () => {
    writeFileSync(cfgPath, JSON.stringify({
      vaultPath: '/tmp/vault', sqlitePath: '/tmp/kb.sqlite',
      modelAdapter: { defaultCli: 'claude', fallbackCli: 'codex' },
      agents: {},
    }, null, 2));
    const cfg = loadServerConfig(cfgPath);
    expect(cfg.defaultModel.writer.cli).toBe('claude');
    expect(cfg.defaultModel.writer.model).toBe('claude-opus-4-6');
    expect(cfg.defaultModel.other.cli).toBe('claude');
    expect(cfg.defaultModel.other.model).toBe('claude-sonnet-4-5');
  });
});
```

- [ ] **Step 2: Run test — FAIL**

Run: `pnpm --filter @crossing/web-server test config-store-migration`
Expected: FAIL — `cfg.defaultModel` is undefined (field not yet on ServerConfig).

- [ ] **Step 3: Extend ServerConfig + migration**

Open `packages/web-server/src/config.ts`. Replace entire file:

```ts
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import type { AgentConfig } from "@crossing/agents";

function expand(p: string): string {
  return p.startsWith("~") ? resolve(homedir(), p.slice(2)) : p;
}

export interface DefaultModelEntry {
  cli: "claude" | "codex";
  model?: string;
}

export interface DefaultModelConfig {
  writer: DefaultModelEntry;
  other: DefaultModelEntry;
}

export interface ServerConfig {
  vaultPath: string;
  sqlitePath: string;
  projectsDir: string;
  expertsDir: string;
  defaultCli: "claude" | "codex";
  fallbackCli: "claude" | "codex";
  defaultModel: DefaultModelConfig;
  agents: Record<string, AgentConfig>;
  configPath: string;
}

const HARDCODED_DEFAULT_MODEL: DefaultModelConfig = {
  writer: { cli: "claude", model: "claude-opus-4-6" },
  other:  { cli: "claude", model: "claude-sonnet-4-5" },
};

function migrateRaw(raw: Record<string, unknown>): { migrated: boolean; result: Record<string, unknown> } {
  let migrated = false;
  const agents = (raw.agents ?? {}) as Record<string, AgentConfig & { reference_accounts?: string[] }>;

  if (!raw.defaultModel) {
    migrated = true;
    const writerAgent = Object.entries(agents).find(([k]) => k.startsWith("writer."));
    const otherAgent  = Object.entries(agents).find(([k]) => !k.startsWith("writer."));
    raw.defaultModel = {
      writer: writerAgent
        ? { cli: writerAgent[1].cli, ...(writerAgent[1].model !== undefined ? { model: writerAgent[1].model } : {}) }
        : HARDCODED_DEFAULT_MODEL.writer,
      other: otherAgent
        ? { cli: otherAgent[1].cli, ...(otherAgent[1].model !== undefined ? { model: otherAgent[1].model } : {}) }
        : HARDCODED_DEFAULT_MODEL.other,
    };
  }

  for (const [key, entry] of Object.entries(agents)) {
    if ('model' in entry) {
      delete (entry as { model?: unknown }).model;
      migrated = true;
    }
    if ('reference_accounts' in entry) {
      delete (entry as { reference_accounts?: unknown }).reference_accounts;
      migrated = true;
    }
    agents[key] = entry;
  }
  raw.agents = agents;

  return { migrated, result: raw };
}

export function loadServerConfig(path: string): ServerConfig {
  const raw = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  const { migrated, result } = migrateRaw(raw);
  if (migrated) {
    const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
    writeFileSync(tmp, JSON.stringify(result, null, 2), "utf-8");
    renameSync(tmp, path);
  }
  const vaultPath = expand(result.vaultPath as string);
  const modelAdapter = (result.modelAdapter ?? {}) as { defaultCli?: string; fallbackCli?: string };
  return {
    vaultPath,
    sqlitePath: expand(result.sqlitePath as string),
    projectsDir: join(vaultPath, "07_projects"),
    expertsDir: join(vaultPath, "08_experts"),
    defaultCli: (modelAdapter.defaultCli ?? "claude") as "claude" | "codex",
    fallbackCli: (modelAdapter.fallbackCli ?? "claude") as "claude" | "codex",
    defaultModel: result.defaultModel as DefaultModelConfig,
    agents: (result.agents ?? {}) as Record<string, AgentConfig>,
    configPath: resolve(path),
  };
}
```

- [ ] **Step 4: Run test — PASS**

Run: `pnpm --filter @crossing/web-server test config-store-migration`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/web-server/src/config.ts packages/web-server/tests/config-store-migration.test.ts
git commit -m "$(cat <<'EOF'
feat(web-server): ServerConfig.defaultModel + legacy migration

SP-C Task 1. Loads legacy JSON, derives writer/other defaults from
first matching agent's per-agent model, purges per-agent model and
reference_accounts, writes back once. Degenerate case (no agents)
falls back to hardcoded claude opus / sonnet. Idempotent.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `resolveModelForAgent` helper

**Files:**
- Create: `packages/web-server/src/services/model-resolver.ts`
- Create: `packages/web-server/tests/model-resolver.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/web-server/tests/model-resolver.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveModelForAgent } from '../src/services/model-resolver.js';
import type { DefaultModelConfig } from '../src/config.js';

const DM: DefaultModelConfig = {
  writer: { cli: 'claude', model: 'claude-opus-4-6' },
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
```

- [ ] **Step 2: Run test — FAIL**

Run: `pnpm --filter @crossing/web-server test model-resolver`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/web-server/src/services/model-resolver.ts`:

```ts
import type { DefaultModelConfig, DefaultModelEntry } from '../config.js';

/**
 * SP-C resolver. Routes agentKey to the writer or other tier.
 * Writer tier: any agentKey starting with `writer.` (covers opening/practice/closing).
 * Other tier: everything else (brief_analyst, practice.stitcher, style_critic, topic_expert.*, etc.).
 *
 * Returns a shallow copy so callers can mutate without leaking into the
 * shared config.
 */
export function resolveModelForAgent(
  agentKey: string,
  defaultModel: DefaultModelConfig,
): DefaultModelEntry {
  const source = agentKey.startsWith('writer.') ? defaultModel.writer : defaultModel.other;
  return { ...source };
}
```

- [ ] **Step 4: Run test — PASS**

Run: `pnpm --filter @crossing/web-server test model-resolver`
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/web-server/src/services/model-resolver.ts packages/web-server/tests/model-resolver.test.ts
git commit -m "$(cat <<'EOF'
feat(web-server): resolveModelForAgent — route writer.* to writer, else other

SP-C Task 2. Pure function, returns a shallow copy of the resolved
DefaultModelEntry so callers can mutate (e.g., per-request model
overrides) without polluting shared config.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Remove `reference_accounts` — backend

**Files:**
- Modify: `packages/agents/src/config.ts`
- Modify: `packages/web-server/src/services/writer-orchestrator.ts`
- Modify: `packages/web-server/src/routes/writer.ts`
- Modify: `packages/web-server/src/services/agent-config-store.ts`
- Existing tests that assert on refs: update/remove

- [ ] **Step 1: Drop field from AgentConfig type (agents package)**

Open `packages/agents/src/config.ts`. Change:

```ts
export interface AgentConfig {
  cli: "claude" | "codex";
  model?: string;
  reference_accounts?: string[];  // DELETE THIS LINE
}
```

to:

```ts
export interface AgentConfig {
  cli: "claude" | "codex";
  model?: string;
}
```

- [ ] **Step 2: writer-orchestrator refs excision**

Open `packages/web-server/src/services/writer-orchestrator.ts`. Delete the following in order:

Remove the `loadReferenceAccountKb` function (whole function, typically lines ~133-142).

Remove the `refsBlock` helper.

Change `buildOpeningUserMessage(briefSummary, missionSummary, productOverview, refs)` → `buildOpeningUserMessage(briefSummary, missionSummary, productOverview)`. Delete the `# 参考账号风格素材` section from the assembled output.

Same for `buildPracticeUserMessage`, `buildClosingUserMessage`, `buildCriticUserMessage` — remove `refs` parameter and `# 参考账号风格素材` body.

In `runWriter`:

Remove every `const refs = await loadReferenceAccountKb(...)` line and remove `refs` from any downstream user-message calls.

`WriterConfig.reference_accounts_per_agent` — delete the field from the type AND every place that populates or reads it. Also cascade the change to the `WriterConfig` import in route layer.

- [ ] **Step 3: Route layer refs excision**

Open `packages/web-server/src/routes/writer.ts`. Delete the `loadRefs(vaultPath, ids)` helper (typically near top). In rewrite endpoint around `const refs = await loadRefs(...)`, delete the line and remove refs from downstream user-message builds. In `/writer/start` endpoint, remove any `reference_accounts_per_agent` writes to `writer_config` metadata.

Remove any `# 参考账号风格素材` template literal segments from the three surgical user-message concatenations in the rewrite route.

- [ ] **Step 4: Update tests**

Run: `pnpm --filter @crossing/web-server test 2>&1 | tail -40`

Iterate on any failures that reference refs:
- `writer-orchestrator*.test.ts` — remove expectations on `loadReferenceAccountKb` / refs fields
- `writer.ts` route tests — remove refs-related assertions
- `config-merger.test.ts` — no refs assertions expected; skip

Typecheck: `pnpm --filter @crossing/web-server exec tsc --noEmit` — any `reference_accounts` type errors are stale references to cleaned API; delete those sites.

- [ ] **Step 5: Grep verify zero remaining references**

Run:
```bash
grep -r "reference_accounts" packages/web-server packages/agents --include="*.ts" -l
grep -r "loadReferenceAccountKb\|refsBlock\|loadRefs" packages/web-server --include="*.ts" -l
```

Expected: both commands produce zero output.

- [ ] **Step 6: Commit**

```bash
git add packages/agents/src/config.ts packages/web-server/src/services/writer-orchestrator.ts packages/web-server/src/routes/writer.ts
git add packages/web-server/tests/  # any test updates
git commit -m "$(cat <<'EOF'
refactor: remove reference_accounts from backend + writer plumbing

SP-C Task 3. AgentConfig.reference_accounts dropped; writer orchestrator
no longer loads reference-account KB files, no longer renders
"# 参考账号风格素材" in user messages; rewrite/start routes drop loadRefs.
Writer style now flows exclusively through styleBinding → StylePanel.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Remove `reference_accounts` — UI

**Files:**
- Modify: `packages/web-ui/src/api/writer-client.ts`
- Modify: `packages/web-ui/src/components/config/AgentCard.tsx` (deletion comes in Task 7 but refs field removal now)
- Modify: `packages/web-ui/src/components/config/AgentsPanel.tsx` (same)
- Modify: `packages/web-ui/src/components/config/ProjectOverridePanel.tsx`

- [ ] **Step 1: Drop refs from API types**

Open `packages/web-ui/src/api/writer-client.ts`. Find the `AgentConfigEntry` interface and the `AgentConfig` interface (near line ~270 area). Remove `reference_accounts?: string[]` from both. Also remove from `ProjectOverride.agents[key]` via the partial pickup — no explicit edit needed since it propagates through the `Partial<AgentConfigEntry>` type.

- [ ] **Step 2: AgentsPanel refs UI removal**

Open `packages/web-ui/src/components/config/AgentsPanel.tsx`. Find every handler / UI section that reads or writes `cfg.reference_accounts` (usually a multi-select of style panels mapped to accounts). Delete those sections entirely — both the inputs in AgentCard and the state plumbing in AgentsPanel. Also delete the `panels` state + related `listConfigStylePanels` call if it's only used for refs.

Open `packages/web-ui/src/components/config/AgentCard.tsx`. Delete the `reference_accounts` prop + the picker block.

Open `packages/web-ui/src/components/config/ProjectOverridePanel.tsx`. Delete refs override section.

- [ ] **Step 3: Grep UI verify**

```bash
grep -r "reference_accounts" packages/web-ui --include="*.ts" --include="*.tsx" -l
```

Expected: zero matches.

- [ ] **Step 4: Run UI tests**

Run: `pnpm --filter @crossing/web-ui test 2>&1 | tail -30`

Fix any tests that were asserting on refs rendering — remove those assertions. Existing snapshot tests may need `-u` to update if the refs block was in the snapshot.

- [ ] **Step 5: Commit**

```bash
git add packages/web-ui/src/api/writer-client.ts packages/web-ui/src/components/config/
git add packages/web-ui/src/components/config/__tests__/  # any test updates
git commit -m "$(cat <<'EOF'
refactor(web-ui): remove reference_accounts from client types + UI

SP-C Task 4. AgentConfigEntry / AgentConfig API types drop
reference_accounts. AgentCard, AgentsPanel, ProjectOverridePanel
drop refs pickers. UI no longer offers per-agent reference-account
selection.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Writer orchestrator + route use `resolveModelForAgent`

**Files:**
- Modify: `packages/web-server/src/services/writer-orchestrator.ts`
- Modify: `packages/web-server/src/routes/writer.ts`
- Modify: `packages/web-server/tests/writer-orchestrator*.test.ts` (if needed)

- [ ] **Step 1: Write a regression test first**

Append to `packages/web-server/tests/writer-orchestrator-validation.test.ts` (or create a new file `writer-orchestrator-resolver.test.ts` if the existing one has a different scope):

```ts
import { describe, it, expect } from 'vitest';
import { resolveModelForAgent } from '../src/services/model-resolver.js';
import type { DefaultModelConfig } from '../src/config.js';

describe('writer-orchestrator uses model-resolver (smoke)', () => {
  it('resolveModelForAgent used with ServerConfig.defaultModel shape', () => {
    const dm: DefaultModelConfig = {
      writer: { cli: 'claude', model: 'claude-opus-4-6' },
      other:  { cli: 'claude', model: 'claude-sonnet-4-5' },
    };
    expect(resolveModelForAgent('writer.opening', dm).model).toBe('claude-opus-4-6');
    expect(resolveModelForAgent('practice.stitcher', dm).model).toBe('claude-sonnet-4-5');
  });
});
```

(This is a sanity import test — any deletion of the resolver breaks compilation.)

- [ ] **Step 2: writer-orchestrator switch**

Open `packages/web-server/src/services/writer-orchestrator.ts`. Find the existing `resolve(key, cfg)` local helper (around line ~144 in current tree):

```ts
function resolve(
  key: WriterAgentKey,
  cfg: WriterConfig,
  fallbackCli: "claude" | "codex" = "claude",
): { cli: "claude" | "codex"; model?: string; referenceAccounts: string[] } {
  const cliModel = cfg.cli_model_per_agent[key];
  const refs = cfg.reference_accounts_per_agent[key] ?? [];
  return {
    cli: cliModel?.cli ?? fallbackCli,
    model: cliModel?.model,
    referenceAccounts: refs,
  };
}
```

Replace with:

```ts
import { resolveModelForAgent } from './model-resolver.js';
// (Add at top of file with other imports.)

function resolve(
  key: WriterAgentKey,
  defaultModel: DefaultModelConfig,
): { cli: "claude" | "codex"; model?: string } {
  return resolveModelForAgent(key, defaultModel);
}
```

(referenceAccounts field is gone from the return since Task 3 cleared refs.)

Update every call site inside `runWriter` that previously passed `cfg` to `resolve` — now pass `opts.defaultModel`. `RunWriterOpts` gains:

```ts
export interface RunWriterOpts {
  // ... existing fields
  defaultModel: DefaultModelConfig;  // NEW: replaces per-agent writerConfig lookup
  writerConfig: WriterConfig;  // keep for styleBinding / tools lookup
}
```

`WriterConfig` loses `cli_model_per_agent` after this task; update the type. Remove the type from exports.

Actually, since B.3 already uses `writerConfig` for `cli_model_per_agent` lookups, and we are replacing that path, the simplest is: keep `writerConfig` for bookkeeping (e.g., tools) but switch all model lookups to go through `resolve(key, opts.defaultModel)`.

- [ ] **Step 3: Route layer switch**

Open `packages/web-server/src/routes/writer.ts`. In `/writer/start` endpoint, find `const writerConfig = await mergeWriterConfig(deps, body);` — this builds a `WriterConfig` with `cli_model_per_agent`. After the refactor, `WriterConfig` loses `cli_model_per_agent`. Remove that subtree. 

Then find `runWriter({... writerConfig, ...})` and add `defaultModel: deps.configStore.current.defaultModel`.

In the `/rewrite` endpoint, find:
```ts
const cfg = project.writer_config;
const cliModel = cfg?.cli_model_per_agent?.[agentKey] ?? { cli: "claude" };
```

Replace with:
```ts
const dm = deps.configStore.current.defaultModel;
const cliModel = (await import('../services/model-resolver.js')).resolveModelForAgent(agentKey, dm);
```

(Or move the import to the top of the file — preferred.)

- [ ] **Step 4: Run full server test suite**

Run: `pnpm --filter @crossing/web-server test 2>&1 | tail -30`
Expected: existing tests continue to pass; resolver smoke test PASS.

Typecheck: `pnpm --filter @crossing/web-server exec tsc --noEmit` — must be clean modulo the 3 pre-existing errors flagged in SP-B.3 commits.

- [ ] **Step 5: Commit**

```bash
git add packages/web-server/src/services/writer-orchestrator.ts packages/web-server/src/routes/writer.ts
git add packages/web-server/tests/
git commit -m "$(cat <<'EOF'
refactor(web-server): writer orchestrator + rewrite route use resolveModelForAgent

SP-C Task 5. Per-agent model lookup via cli_model_per_agent replaced
by global defaultModel resolution. WriterConfig loses cli_model_per_agent.
Both /writer/start and /writer/sections/:key/rewrite now read the
current ServerConfig.defaultModel and route through resolveModelForAgent.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Drop `model` from `AgentConfigEntry` + fix merger

**Files:**
- Modify: `packages/web-server/src/services/agent-config-store.ts`
- Modify: `packages/web-server/src/services/config-merger.ts`
- Modify: `packages/web-server/src/services/project-override-store.ts`
- Modify: `packages/web-server/tests/config-merger.test.ts`
- Modify: `packages/web-server/tests/agent-config-store.test.ts`

- [ ] **Step 1: Write failing test for merger handling defaultModel override**

Append to `packages/web-server/tests/config-merger.test.ts`:

```ts
import { mergeDefaultModel } from '../src/services/config-merger.js';
import type { DefaultModelConfig } from '../src/config.js';

describe('mergeDefaultModel', () => {
  const globalDM: DefaultModelConfig = {
    writer: { cli: 'claude', model: 'claude-opus-4-6' },
    other:  { cli: 'claude', model: 'claude-sonnet-4-5' },
  };

  it('no override → returns global (deep-copied)', () => {
    const m = mergeDefaultModel(globalDM, undefined);
    expect(m).toEqual(globalDM);
    expect(m.writer).not.toBe(globalDM.writer);
  });

  it('override writer only → writer replaced, other kept', () => {
    const m = mergeDefaultModel(globalDM, { writer: { cli: 'codex', model: 'gpt-5' } });
    expect(m.writer).toEqual({ cli: 'codex', model: 'gpt-5' });
    expect(m.other).toEqual(globalDM.other);
  });

  it('override other only → other replaced, writer kept', () => {
    const m = mergeDefaultModel(globalDM, { other: { cli: 'codex', model: 'gpt-5' } });
    expect(m.other).toEqual({ cli: 'codex', model: 'gpt-5' });
    expect(m.writer).toEqual(globalDM.writer);
  });

  it('empty override → identical to no override', () => {
    const m = mergeDefaultModel(globalDM, {});
    expect(m).toEqual(globalDM);
  });
});
```

Run: `pnpm --filter @crossing/web-server test config-merger`
Expected: FAIL — `mergeDefaultModel` not exported.

- [ ] **Step 2: Implement merger + type changes**

Open `packages/web-server/src/services/project-override-store.ts`. Find `ProjectOverride` interface. Update to:

```ts
import type { DefaultModelConfig } from '../config.js';

export interface ProjectOverride {
  agents?: Record<string, Partial<AgentConfigEntry>>;
  defaultModel?: Partial<DefaultModelConfig>;  // NEW
}
```

Open `packages/web-server/src/services/agent-config-store.ts`. Update `AgentConfigEntry`:

```ts
export interface AgentConfigEntry {
  agentKey: string;
  // model field REMOVED — use resolveModelForAgent against ServerConfig.defaultModel
  promptVersion?: string;
  styleBinding?: AgentStyleBinding;
  tools?: AgentToolsConfig;
}
```

Update the `validate` function — remove the `if (!cfg.model || ...)` block and the `if (cfg.model.cli !== "claude" ...)` block.

Update `DEFAULT_AGENT_CONFIGS`:
```ts
export const DEFAULT_AGENT_CONFIGS: Record<string, AgentConfigEntry> = {
  section_slicer: { agentKey: "section_slicer" },
};
```
(The sonnet-4-5 default is now implicit in `defaultModel.other`.)

Open `packages/web-server/src/services/config-merger.ts`. Replace entire file:

```ts
import type { AgentConfigEntry } from "./agent-config-store.js";
import type { ProjectOverride } from "./project-override-store.js";
import type { DefaultModelConfig } from "../config.js";

export function mergeAgentConfig(
  global: AgentConfigEntry,
  override?: Partial<AgentConfigEntry>,
): AgentConfigEntry {
  if (!override) {
    return {
      agentKey: global.agentKey,
      ...(global.promptVersion !== undefined ? { promptVersion: global.promptVersion } : {}),
      ...(global.styleBinding ? { styleBinding: { ...global.styleBinding } } : {}),
      ...(global.tools ? { tools: { ...global.tools } } : {}),
    };
  }

  const merged: AgentConfigEntry = { agentKey: global.agentKey };

  const promptVersion =
    override.promptVersion !== undefined ? override.promptVersion : global.promptVersion;
  if (promptVersion !== undefined) merged.promptVersion = promptVersion;

  const styleBinding = override.styleBinding ? override.styleBinding : global.styleBinding;
  if (styleBinding) merged.styleBinding = { ...styleBinding };

  if (global.tools || override.tools) {
    merged.tools = { ...(global.tools ?? {}), ...(override.tools ?? {}) };
  }

  return merged;
}

export function mergeAllAgentConfigs(
  globals: Record<string, AgentConfigEntry>,
  override: ProjectOverride | null,
): Record<string, AgentConfigEntry> {
  const out: Record<string, AgentConfigEntry> = {};
  const overrideAgents = override?.agents ?? {};
  for (const [key, entry] of Object.entries(globals)) {
    out[key] = mergeAgentConfig(entry, overrideAgents[key]);
  }
  return out;
}

export function mergeDefaultModel(
  global: DefaultModelConfig,
  override?: Partial<DefaultModelConfig>,
): DefaultModelConfig {
  if (!override) return { writer: { ...global.writer }, other: { ...global.other } };
  return {
    writer: override.writer ? { ...override.writer } : { ...global.writer },
    other:  override.other  ? { ...override.other  } : { ...global.other  },
  };
}
```

- [ ] **Step 3: Update existing tests**

Run: `pnpm --filter @crossing/web-server test 2>&1 | tail -40`

Tests that construct `AgentConfigEntry` with `model` will fail now. Update them — remove the `model` field from fixtures. Example fix:

```ts
// Before:
const entry: AgentConfigEntry = {
  agentKey: 'writer.opening',
  model: { cli: 'claude', model: 'claude-opus-4-6' },
};
// After:
const entry: AgentConfigEntry = {
  agentKey: 'writer.opening',
};
```

Also update `validate` tests in `agent-config-store.test.ts` — remove tests that assert "validate throws when model is missing" (it no longer does).

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @crossing/web-server test 2>&1 | tail -20`
Expected: all green (modulo the 3 pre-existing case-plan-orchestrator failures).

Typecheck: `pnpm --filter @crossing/web-server exec tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add packages/web-server/src/services/agent-config-store.ts
git add packages/web-server/src/services/config-merger.ts
git add packages/web-server/src/services/project-override-store.ts
git add packages/web-server/tests/
git commit -m "$(cat <<'EOF'
refactor(web-server): drop AgentConfigEntry.model + merger defaultModel path

SP-C Task 6. AgentConfigEntry no longer carries model (resolver reads
from ServerConfig.defaultModel instead). validate() no longer requires
model. ProjectOverride gains defaultModel?: Partial<DefaultModelConfig>
and mergeDefaultModel overlays it onto global.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: API — expose `defaultModel` via `/api/config`

**Files:**
- Modify: `packages/web-server/src/routes/config.ts`
- Modify: `packages/web-server/src/services/config-store.ts`
- Modify: `packages/web-server/tests/config.test.ts`

- [ ] **Step 1: Write test for PUT /api/config default_model**

Append to `packages/web-server/tests/config.test.ts` (or create if missing):

```ts
describe('PUT /api/config — defaultModel', () => {
  it('persists defaultModel.writer change', async () => {
    // setup a fastify app with config route + temp config file
    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/config',
      payload: {
        defaultModel: {
          writer: { cli: 'codex', model: 'gpt-5' },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const getRes = await app.inject({ method: 'GET', url: '/api/config' });
    const body = JSON.parse(getRes.payload);
    expect(body.defaultModel.writer).toEqual({ cli: 'codex', model: 'gpt-5' });
  });
});
```

(If `buildApp` / `config.test.ts` don't exist, mirror the setup used in `config-agents-routes.test.ts`.)

- [ ] **Step 2: Extend ConfigStore patch surface**

Open `packages/web-server/src/services/config-store.ts`. Extend `AgentConfigPatch`:

```ts
import type { DefaultModelConfig } from '../config.js';

export interface AgentConfigPatch {
  defaultCli?: "claude" | "codex";
  fallbackCli?: "claude" | "codex";
  agents?: Record<string, AgentConfig>;
  defaultModel?: Partial<DefaultModelConfig>;  // NEW
}
```

In `doUpdate`, after the `agents` clause add:

```ts
if (patch.defaultModel != null) {
  raw.defaultModel = { ...(raw.defaultModel ?? {}), ...patch.defaultModel };
}
```

- [ ] **Step 3: Wire GET/PUT route**

Open `packages/web-server/src/routes/config.ts`. Find the GET handler and append `defaultModel: current.defaultModel` to the response object. Find the PUT handler's body validator — allow `defaultModel` object shape:

```ts
if (body.defaultModel) {
  const dm = body.defaultModel;
  if (dm.writer && typeof dm.writer.cli !== 'string') {
    return reply.code(400).send({ error: 'defaultModel.writer.cli required when writer present' });
  }
  if (dm.other && typeof dm.other.cli !== 'string') {
    return reply.code(400).send({ error: 'defaultModel.other.cli required when other present' });
  }
}
```

Pass `defaultModel` to `configStore.update({ defaultModel: body.defaultModel })`.

- [ ] **Step 4: Tests + typecheck**

Run: `pnpm --filter @crossing/web-server test config` — green.
Typecheck: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/web-server/src/services/config-store.ts packages/web-server/src/routes/config.ts packages/web-server/tests/config.test.ts
git commit -m "$(cat <<'EOF'
feat(web-server): /api/config GET/PUT surface defaultModel

SP-C Task 7. GET /api/config returns defaultModel alongside existing
fields. PUT /api/config accepts partial defaultModel updates
(writer/other separately). Validator rejects malformed cli. Persists
via ConfigStore.update.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: UI — ConfigWorkbench 2-tab rewrite

**Files:**
- Create: `packages/web-ui/src/components/config/BaseTabPanel.tsx`
- Create: `packages/web-ui/src/components/config/StatusTabPanel.tsx`
- Create: `packages/web-ui/src/components/config/__tests__/BaseTabPanel.test.tsx`
- Modify: `packages/web-ui/src/pages/ConfigWorkbench.tsx`
- Modify: `packages/web-ui/src/api/writer-client.ts` — add `getDefaultModel`, `setDefaultModel`
- Delete: `packages/web-ui/src/components/config/AgentsPanel.tsx`
- Delete: `packages/web-ui/src/components/config/AgentCard.tsx`
- Delete: `packages/web-ui/src/components/config/__tests__/AgentsPanel.test.tsx`
- Delete: `packages/web-ui/src/components/config/__tests__/AgentCard.test.tsx`

- [ ] **Step 1: Add client API functions**

Open `packages/web-ui/src/api/writer-client.ts`. Append:

```ts
export interface DefaultModelEntry {
  cli: 'claude' | 'codex';
  model?: string;
}
export interface DefaultModelConfig {
  writer: DefaultModelEntry;
  other: DefaultModelEntry;
}

export async function getDefaultModel(): Promise<DefaultModelConfig> {
  const res = await throwingFetch('/api/config');
  const body = await res.json();
  return body.defaultModel as DefaultModelConfig;
}

export async function setDefaultModel(
  patch: Partial<DefaultModelConfig>,
): Promise<void> {
  await throwingFetch('/api/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ defaultModel: patch }),
  });
}
```

- [ ] **Step 2: Write BaseTabPanel failing test**

Create `packages/web-ui/src/components/config/__tests__/BaseTabPanel.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BaseTabPanel } from '../BaseTabPanel.js';

vi.mock('../../../api/writer-client.js', () => ({
  getDefaultModel: vi.fn().mockResolvedValue({
    writer: { cli: 'claude', model: 'claude-opus-4-6' },
    other:  { cli: 'claude', model: 'claude-sonnet-4-5' },
  }),
  setDefaultModel: vi.fn().mockResolvedValue(undefined),
  getAgentConfigs: vi.fn().mockResolvedValue({ agents: {} }),
}));

describe('BaseTabPanel', () => {
  it('renders two dropdowns labelled Writer and 其他', async () => {
    render(<BaseTabPanel />);
    await waitFor(() => {
      expect(screen.getByText('Writer 模型')).toBeInTheDocument();
      expect(screen.getByText('其他 agent 模型')).toBeInTheDocument();
    });
  });

  it('dropdowns show the current defaultModel selection', async () => {
    render(<BaseTabPanel />);
    await waitFor(() => {
      expect(screen.getAllByDisplayValue('claude · claude-opus-4-6').length).toBeGreaterThan(0);
      expect(screen.getAllByDisplayValue('claude · claude-sonnet-4-5').length).toBeGreaterThan(0);
    });
  });
});
```

- [ ] **Step 3: Run test — FAIL**

Run: `pnpm --filter @crossing/web-ui test BaseTabPanel`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement BaseTabPanel**

Create `packages/web-ui/src/components/config/BaseTabPanel.tsx`:

```tsx
import { useEffect, useState } from 'react';
import {
  getDefaultModel,
  setDefaultModel,
  getAgentConfigs,
  setAgentConfig,
  listConfigStylePanels,
  type DefaultModelConfig,
  type DefaultModelEntry,
  type AgentConfigEntry,
  type StylePanel,
} from '../../api/writer-client.js';

const MODEL_CHOICES: Array<{ label: string; value: DefaultModelEntry }> = [
  { label: 'claude · claude-opus-4-6',  value: { cli: 'claude', model: 'claude-opus-4-6' } },
  { label: 'claude · claude-sonnet-4-5', value: { cli: 'claude', model: 'claude-sonnet-4-5' } },
  { label: 'codex · gpt-5',              value: { cli: 'codex',  model: 'gpt-5' } },
];

const WRITER_ROLES: Array<{ key: 'writer.opening' | 'writer.practice' | 'writer.closing'; label: string; role: 'opening' | 'practice' | 'closing' }> = [
  { key: 'writer.opening',  label: '开头 (opening)',   role: 'opening' },
  { key: 'writer.practice', label: '实测 (practice)',  role: 'practice' },
  { key: 'writer.closing',  label: '结尾 (closing)',   role: 'closing' },
];

const TOOL_KEYS = ['search_wiki', 'search_raw'] as const;

function entryToLabel(e?: DefaultModelEntry): string {
  if (!e) return '';
  return `${e.cli} · ${e.model ?? ''}`.trim();
}

export function BaseTabPanel() {
  const [dm, setDm] = useState<DefaultModelConfig | null>(null);
  const [agents, setAgents] = useState<Record<string, AgentConfigEntry>>({});
  const [panels, setPanels] = useState<StylePanel[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getDefaultModel().then(setDm).catch(() => setDm(null));
    getAgentConfigs().then((r) => setAgents(r.agents)).catch(() => setAgents({}));
    listConfigStylePanels().then(setPanels).catch(() => setPanels([]));
  }, []);

  async function updateTier(tier: 'writer' | 'other', label: string) {
    const choice = MODEL_CHOICES.find((c) => c.label === label);
    if (!choice || !dm) return;
    setSaving(true);
    try {
      const patch = { [tier]: choice.value } as Partial<DefaultModelConfig>;
      await setDefaultModel(patch);
      setDm({ ...dm, ...patch });
    } finally {
      setSaving(false);
    }
  }

  async function updateBinding(
    agentKey: 'writer.opening' | 'writer.practice' | 'writer.closing',
    role: 'opening' | 'practice' | 'closing',
    account: string,
  ) {
    const current = agents[agentKey] ?? { agentKey };
    const next: AgentConfigEntry = account
      ? { ...current, styleBinding: { account, role } }
      : { ...current, styleBinding: undefined };
    if (!account) delete next.styleBinding;
    setSaving(true);
    try {
      await setAgentConfig(agentKey, next);
      setAgents({ ...agents, [agentKey]: next });
    } finally {
      setSaving(false);
    }
  }

  async function updateTool(
    agentKey: 'writer.opening' | 'writer.practice' | 'writer.closing',
    tool: (typeof TOOL_KEYS)[number],
    enabled: boolean,
  ) {
    const current = agents[agentKey] ?? { agentKey };
    const next: AgentConfigEntry = {
      ...current,
      tools: { ...(current.tools ?? {}), [tool]: enabled },
    };
    setSaving(true);
    try {
      await setAgentConfig(agentKey, next);
      setAgents({ ...agents, [agentKey]: next });
    } finally {
      setSaving(false);
    }
  }

  if (!dm) return <div className="text-sm text-[var(--meta)]">加载中…</div>;

  const accountsByRole = (role: 'opening' | 'practice' | 'closing'): string[] => {
    const accounts = new Set<string>();
    for (const p of panels) {
      if (p.role === role && p.status === 'active') accounts.add(p.account);
    }
    return Array.from(accounts).sort();
  };

  return (
    <div className="space-y-6">
      <section>
        <div className="text-xs uppercase tracking-wide text-[var(--meta)] mb-2">模型</div>
        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <div className="text-sm font-medium mb-1">Writer 模型</div>
            <select
              className="w-full px-3 py-2 bg-[var(--bg-2)] border border-[var(--hair)] rounded text-sm"
              value={entryToLabel(dm.writer)}
              disabled={saving}
              onChange={(e) => updateTier('writer', e.target.value)}
            >
              {MODEL_CHOICES.map((c) => <option key={c.label} value={c.label}>{c.label}</option>)}
            </select>
          </label>
          <label className="block">
            <div className="text-sm font-medium mb-1">其他 agent 模型</div>
            <select
              className="w-full px-3 py-2 bg-[var(--bg-2)] border border-[var(--hair)] rounded text-sm"
              value={entryToLabel(dm.other)}
              disabled={saving}
              onChange={(e) => updateTier('other', e.target.value)}
            >
              {MODEL_CHOICES.map((c) => <option key={c.label} value={c.label}>{c.label}</option>)}
            </select>
          </label>
        </div>
      </section>

      <section>
        <div className="text-xs uppercase tracking-wide text-[var(--meta)] mb-2">Writer 风格绑定</div>
        <div className="space-y-2">
          {WRITER_ROLES.map(({ key, label, role }) => {
            const binding = agents[key]?.styleBinding;
            const options = accountsByRole(role);
            return (
              <div key={key} className="flex items-center gap-3 px-3 py-2 rounded bg-[var(--bg-2)]">
                <div className="text-sm w-32">{label}</div>
                <select
                  className="flex-1 px-2 py-1.5 bg-[var(--bg-1)] border border-[var(--hair)] rounded text-sm"
                  value={binding?.account ?? ''}
                  disabled={saving}
                  onChange={(e) => updateBinding(key, role, e.target.value)}
                >
                  <option value="">（未绑定）</option>
                  {options.map((acc) => <option key={acc} value={acc}>{acc}</option>)}
                </select>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <div className="text-xs uppercase tracking-wide text-[var(--meta)] mb-2">Writer 工具</div>
        <div className="rounded bg-[var(--bg-2)] p-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-[var(--meta)]">
                <th className="text-left font-normal pb-2">Agent</th>
                {TOOL_KEYS.map((t) => <th key={t} className="text-center font-normal pb-2">{t}</th>)}
              </tr>
            </thead>
            <tbody>
              {WRITER_ROLES.map(({ key, label }) => {
                const tools = agents[key]?.tools ?? {};
                return (
                  <tr key={key} className="border-t border-[var(--hair)]">
                    <td className="py-2">{label}</td>
                    {TOOL_KEYS.map((t) => (
                      <td key={t} className="text-center">
                        <input
                          type="checkbox"
                          checked={tools[t] !== false}
                          disabled={saving}
                          onChange={(e) => updateTool(key, t, e.target.checked)}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 5: Implement StatusTabPanel**

Create `packages/web-ui/src/components/config/StatusTabPanel.tsx`:

```tsx
import { useCliHealth } from '../../hooks/useCliHealth';

export function StatusTabPanel() {
  const { data: health } = useCliHealth();
  const tools = [
    { name: 'search_wiki', desc: '知识库 FTS 检索', attached: 'Writer agent' },
    { name: 'search_raw',  desc: '原始素材检索',    attached: 'Writer agent' },
    { name: 'kb.search',   desc: 'KB 查询',         attached: 'Topic Expert' },
  ];
  return (
    <div className="space-y-6">
      <section>
        <div className="text-xs uppercase tracking-wide text-[var(--meta)] mb-2">CLI 健康</div>
        <div className="grid grid-cols-2 gap-3">
          {(['claude','codex'] as const).map((c) => (
            <div key={c} className="rounded bg-[var(--bg-2)] p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="font-semibold" style={{ fontFamily: 'var(--font-mono)' }}>{c}</div>
                <span className={`text-[10px] ${health?.[c]?.status === 'online' ? 'text-[var(--accent)]' : 'text-[var(--red)]'}`}>
                  {health?.[c]?.status ?? '—'}
                </span>
              </div>
              <div className="text-xs text-[var(--meta)]" style={{ fontFamily: 'var(--font-mono)' }}>
                {health?.[c]?.version ?? '—'}
              </div>
            </div>
          ))}
        </div>
      </section>
      <section>
        <div className="text-xs uppercase tracking-wide text-[var(--meta)] mb-2">工具集</div>
        <div className="space-y-2">
          {tools.map((t) => (
            <div key={t.name} className="flex items-center gap-3 px-3 py-2.5 rounded bg-[var(--bg-2)]">
              <code className="text-sm text-[var(--accent)]" style={{ fontFamily: 'var(--font-mono)' }}>{t.name}</code>
              <span className="text-sm text-[var(--body)] flex-1">{t.desc}</span>
              <span className="text-xs text-[var(--meta)]">{t.attached}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 6: Rewrite ConfigWorkbench**

Overwrite `packages/web-ui/src/pages/ConfigWorkbench.tsx`:

```tsx
import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui';
import { BaseTabPanel } from '../components/config/BaseTabPanel.js';
import { StatusTabPanel } from '../components/config/StatusTabPanel.js';

type TabKey = 'base' | 'status';

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'base',   label: '基础' },
  { key: 'status', label: '状态' },
];

export function ConfigWorkbench() {
  const [active, setActive] = useState<TabKey>('base');
  return (
    <div
      data-testid="page-config-workbench"
      className="rounded border border-[var(--hair)] bg-[var(--bg-1)] overflow-hidden"
    >
      <header className="flex items-center justify-between px-6 h-12 border-b border-[var(--hair)]">
        <h1 className="text-lg font-semibold text-[var(--heading)]">配置</h1>
      </header>
      <Tabs value={active} onValueChange={(v) => setActive(v as TabKey)}>
        <div className="px-6 pt-3">
          <TabsList>
            {TABS.map((t) => <TabsTrigger key={t.key} value={t.key}>{t.label}</TabsTrigger>)}
          </TabsList>
        </div>
        <TabsContent value="base"   className="p-6"><BaseTabPanel /></TabsContent>
        <TabsContent value="status" className="p-6"><StatusTabPanel /></TabsContent>
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 7: Delete obsolete files**

```bash
git rm packages/web-ui/src/components/config/AgentsPanel.tsx
git rm packages/web-ui/src/components/config/AgentCard.tsx
git rm packages/web-ui/src/components/config/__tests__/AgentsPanel.test.tsx
git rm packages/web-ui/src/components/config/__tests__/AgentCard.test.tsx
```

- [ ] **Step 8: Run UI tests**

Run: `pnpm --filter @crossing/web-ui test 2>&1 | tail -20`
Expected: PASS including new BaseTabPanel tests; no regressions.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(web-ui): ConfigWorkbench 2-tab rewrite (基础 + 状态)

SP-C Task 8. Replaces 4-tab panel (Agent 团 / 模型 CLI / 工具集 /
选题专家) with 2 tabs — 基础 (2 model dropdowns wired to
/api/config defaultModel) and 状态 (CLI health + tool list
read-only). AgentsPanel + AgentCard deleted. Topic experts will
move to top-nav in Task 9.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: UI — Top-nav entries + TopicExperts page

**Files:**
- Create: `packages/web-ui/src/pages/TopicExpertsPage.tsx`
- Create: `packages/web-ui/src/pages/__tests__/TopicExpertsPage.test.tsx`
- Modify: `packages/web-ui/src/App.tsx`
- Modify: `packages/web-ui/src/components/layout/TopNav.tsx`
- Modify: `packages/web-ui/src/components/config/TopicExpertPanel.tsx` (re-export or move)

- [ ] **Step 1: Extract TopicExperts page**

The existing Tab content is in `packages/web-ui/src/components/config/TopicExpertPanel.tsx` (187 lines). That component is still usable. Create a page wrapper:

Create `packages/web-ui/src/pages/TopicExpertsPage.tsx`:

```tsx
import { TopicExpertPanel } from '../components/config/TopicExpertPanel.js';

export function TopicExpertsPage() {
  return (
    <div
      data-testid="page-topic-experts"
      className="rounded border border-[var(--hair)] bg-[var(--bg-1)] overflow-hidden"
    >
      <header className="flex items-center justify-between px-6 h-12 border-b border-[var(--hair)]">
        <h1 className="text-lg font-semibold text-[var(--heading)]">选题专家</h1>
      </header>
      <div className="p-6">
        <TopicExpertPanel />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Register route**

Open `packages/web-ui/src/App.tsx`. Add route next to the other page routes:

```tsx
import { TopicExpertsPage } from "./pages/TopicExpertsPage";
// ...
<Route path="/topic-experts" element={<TopicExpertsPage />} />
```

- [ ] **Step 3: Update TopNav**

Open `packages/web-ui/src/components/layout/TopNav.tsx`. Update `LINKS`:

```tsx
const LINKS = [
  { to: "/", label: "Projects", end: true },
  { to: "/style-panels", label: "风格面板" },
  { to: "/writing-hard-rules", label: "硬规则" },
  { to: "/topic-experts", label: "选题专家" },
  { to: "/config", label: "配置" },
];
```

(`Library` / `Settings` labels replaced with Chinese to match project style and disambiguate from config.)

- [ ] **Step 4: Write page test**

Create `packages/web-ui/src/pages/__tests__/TopicExpertsPage.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TopicExpertsPage } from '../TopicExpertsPage';

vi.mock('../../components/config/TopicExpertPanel.js', () => ({
  TopicExpertPanel: () => <div>topic-expert-panel-stub</div>,
}));

describe('TopicExpertsPage', () => {
  it('renders header and panel', () => {
    render(<TopicExpertsPage />);
    expect(screen.getByText('选题专家')).toBeInTheDocument();
    expect(screen.getByText('topic-expert-panel-stub')).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @crossing/web-ui test 2>&1 | tail -20`
Expected: PASS including new test.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(web-ui): top-nav entries for 风格面板 / 硬规则 / 选题专家

SP-C Task 9. TopicExpertsPage extracted from ConfigWorkbench tab.
TopNav gains entries pointing to /style-panels, /writing-hard-rules,
/topic-experts. Config tab is now solely for model + styleBinding +
tools + CLI status.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Trae project acceptance + validation log

**Files:**
- Modify: `docs/superpowers/specs/2026-04-17-sp-c-config-simplification-design.md` (append validation log)

- [ ] **Step 1: Rebuild + restart server**

```bash
pnpm --filter @crossing/agents build
pnpm --filter @crossing/web-server build
pnpm dev
```

Wait for `Server listening on http://localhost:3001` and UI on :5173.

- [ ] **Step 2: Load old config → verify migration**

If the user's `~/.config/...` config.json still has per-agent `model` + `reference_accounts` fields, the migration runs automatically on first server read. Verify:

```bash
# Replace with actual config path:
cat ~/.config/crossing-writer/config.json | python3 -m json.tool | head -30
```

Expected:
- `defaultModel.writer` + `defaultModel.other` populated
- No `model` field on any agent
- No `reference_accounts` field anywhere

- [ ] **Step 3: Open UI → verify 2-tab + sidebar**

Browser: http://localhost:5173/config

Check:
- Config page shows only 2 tabs: 基础, 状态
- 基础 tab has 2 model dropdowns
- 状态 tab has CLI health + tool list
- Top nav has entries: Projects / 风格面板 / 硬规则 / 选题专家 / 配置
- `/topic-experts` renders the TopicExpertPanel
- No AgentCard / 16-card rendering anywhere

- [ ] **Step 4: Change writer model → verify persistence**

In 基础 tab:
- Change Writer dropdown from `claude claude-opus-4-6` to `claude claude-sonnet-4-5`
- Verify `cat ~/.config/.../config.json` shows `defaultModel.writer.model === 'claude-sonnet-4-5'`
- Change it back to opus.

- [ ] **Step 5: Trigger trae writer rewrite → verify no regressions**

```bash
curl -s -N -X POST http://localhost:3001/api/projects/trae/writer/sections/opening/rewrite \
  -H 'Content-Type: application/json' \
  -d '{"user_hint":"重写开头，保持 300 字"}' \
  --max-time 900 | tee /tmp/trae-opening-spc.sse | grep -E "validation|rewrite_completed|rewrite_failed"
```

Expected:
- `writer.validation_passed` event fires (SP-B.3 still works)
- `writer.rewrite_completed` event fires
- Final opening in `~/CrossingVault/07_projects/trae/article/sections/opening.md` is clean (no refs mention, no `# 参考账号风格素材` header)

- [ ] **Step 6: Grep check — zero refs**

```bash
grep -r "reference_accounts" packages/ --include="*.ts" --include="*.tsx" -l
grep -r "loadReferenceAccountKb\|refsBlock\|loadRefs" packages/ --include="*.ts" --include="*.tsx" -l
grep -r "cli_model_per_agent" packages/ --include="*.ts" --include="*.tsx" -l
```

Expected: no output from all three commands.

- [ ] **Step 7: Append validation log to spec**

Open `docs/superpowers/specs/2026-04-17-sp-c-config-simplification-design.md`. Replace the final `*待实施后追加*` line with:

```markdown
- **2026-04-17**: Trae project smoke test passed SP-C acceptance.
  - Config migration: legacy JSON with per-agent `model` + `reference_accounts` → migrated once on server start → `defaultModel: { writer, other }` populated, agent entries have no `model` / `reference_accounts` ✓
  - ConfigWorkbench renders 2 tabs (基础 + 状态) ✓
  - TopNav shows 风格面板 / 硬规则 / 选题专家 / 配置 entries ✓
  - `/topic-experts` renders TopicExpertPanel ✓
  - Trae opening rewrite via `/api/projects/trae/writer/sections/opening/rewrite`: `writer.validation_passed` attempt=1, chars ~384 ∈ tolerance band ✓
  - Grep audit: `reference_accounts`, `loadReferenceAccountKb`, `refsBlock`, `loadRefs`, `cli_model_per_agent` all zero matches in `packages/` ✓
  - Change Writer tier in 基础 tab → persisted to config.json → next writer run uses new model (verified via `lastMeta.model` in next rewrite SSE) ✓
```

Replace observed numbers with actual values from the run.

- [ ] **Step 8: Commit**

```bash
git add docs/superpowers/specs/2026-04-17-sp-c-config-simplification-design.md
git commit -m "$(cat <<'EOF'
docs(sp-c): validation log — trae smoke test passed SP-C acceptance

SP-C Task 10. Migration one-shot confirmed, 2-tab UI confirmed,
top-nav entries confirmed, trae rewrite still green through B.3,
zero grep hits for removed refs API.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Summary

10 tasks ending in commits:

- **Task 1** — `ServerConfig.defaultModel` + legacy migration (test-first)
- **Task 2** — `resolveModelForAgent` helper (test-first)
- **Task 3** — Backend refs cleanup (types + orchestrator + route)
- **Task 4** — UI refs cleanup (client types + AgentCard / Panel fields)
- **Task 5** — Orchestrator + route switch to resolver
- **Task 6** — Drop `AgentConfigEntry.model` + `mergeDefaultModel`
- **Task 7** — `/api/config` GET/PUT exposes `defaultModel`
- **Task 8** — ConfigWorkbench 2-tab rewrite + BaseTabPanel / StatusTabPanel
- **Task 9** — TopNav entries + TopicExpertsPage extraction
- **Task 10** — Trae smoke acceptance + validation log

Migration order guarantees:
- Task 1 ships new field without breaking callers (old field still there)
- Task 3 removes refs (independent of model changes)
- Task 5 switches orchestrator to new resolver (old AgentConfigEntry.model still there, ignored)
- Task 6 drops old model field (resolver fully in use by then)
- Tasks 7-9 layer UI on top of stable backend
- Task 10 end-to-end acceptance

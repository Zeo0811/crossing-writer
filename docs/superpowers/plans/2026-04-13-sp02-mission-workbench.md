# SP-02 Mission Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `crossing-writer` monorepo 里新增三个 package（agents / web-server / web-ui），打通 Brief 上传 → Brief Analyst → 专家团两轮评审 → 3 候选 Mission → 人工选定 的完整流程，本地 web 交互。

**Architecture:** Fastify 后端 + Vite/React 前端 + TS 写的 Agent 框架（subprocess 调用 codex/claude CLI）。专家团 10 位（ai-kepu-panel 预制）+ 1 张十字路口文风卡（已存 vault）。状态与产物全部落 `~/CrossingVault/07_projects/<id>/` 的 md/json 文件，SSE 推实时进度。

**Tech Stack:** Node.js 20+, pnpm workspace, TypeScript 5, Fastify 5, Vite 5 + React 19, better-sqlite3, mammoth, pdf-parse, @mozilla/readability, vitest, Tailwind 4。

Spec: `docs/superpowers/specs/2026-04-13-sp02-mission-workbench-design.md`

---

## 整体文件结构

```
crossing-writer/
  pnpm-workspace.yaml               # 新增
  package.json                      # 修改：加 workspaces
  packages/
    kb/                             # SP-01 已有，不动
    agents/                         # 新增
      package.json
      tsconfig.json
      src/
        index.ts                    # 公共入口
        config.ts                   # 读 config.json 的 agents map
        model-adapter.ts            # 核心：subprocess 调 CLI
        agent-base.ts               # Agent 基类
        tool-runner.ts              # 为专家暴露 bash tool (crossing-kb search)
        roles/
          brief-analyst.ts
          topic-expert.ts
          coordinator.ts
        prompts/
          brief-analyst.md
          topic-expert-round1.md
          topic-expert-round2.md
          coordinator-round1.md
          coordinator-round2.md
      tests/
    web-server/                     # 新增
      package.json
      tsconfig.json
      src/
        server.ts                   # Fastify app
        config.ts
        routes/
          projects.ts
          brief.ts
          mission.ts
          experts.ts
          stream.ts
          util.ts
        services/
          project-store.ts          # 读写 project.json
          event-log.ts              # events.jsonl
          file-extractor.ts         # docx/pdf/md/txt → md
          url-fetcher.ts            # URL → md
          expert-registry.ts        # 读 08_experts/topic-panel/index.yaml
          refs-fetcher.ts           # 读 refs.sqlite 生成 refs-pack.md
          brief-analyzer-service.ts
          mission-orchestrator.ts
          sse-broadcaster.ts
        state/
          state-machine.ts
      tests/
    web-ui/                         # 新增
      package.json
      tsconfig.json
      vite.config.ts
      index.html
      src/
        main.tsx
        App.tsx
        api/
          client.ts
          types.ts
        hooks/
          useProjects.ts
          useProject.ts
          useProjectStream.ts
        pages/
          ProjectList.tsx
          ProjectWorkbench.tsx
        components/
          layout/
            TopBar.tsx
            SplitPane.tsx
          left/
            BriefSummaryCard.tsx
            MissionCandidateCard.tsx
            SelectedMissionView.tsx
          right/
            BriefIntakeForm.tsx
            ExpertSelector.tsx
            AgentTimeline.tsx
        styles/
          tokens.css
          globals.css
      tests/
```

---

## Task 列表（26 个）

1. Monorepo 骨架（pnpm workspace + 3 package）
2. `packages/agents` ModelAdapter
3. `packages/agents` AgentBase + prompt loader
4. `packages/agents` ToolRunner（crossing-kb bash bridge）
5. `packages/web-server` Fastify 骨架 + config loader
6. `packages/web-server` ProjectStore + events.jsonl
7. `packages/web-server` /api/projects CRUD route
8. `packages/web-server` file-extractor service
9. `packages/web-server` url-fetcher service
10. `packages/web-server` /api/projects/:id/brief upload route
11. `packages/agents` BriefAnalyst role + prompt
12. `packages/web-server` brief-analyzer-service + trigger
13. `packages/web-ui` Vite 骨架 + tokens
14. `packages/web-ui` API client + types
15. `packages/web-ui` ProjectList 页 + 新建项目
16. `packages/web-ui` BriefIntakeForm
17. Vault: 拷 ai-kepu-panel 到 08_experts/ + index.yaml
18. `packages/web-server` ExpertRegistry + /api/experts
19. `packages/web-server` refs-fetcher（生成 refs-pack.md）
20. `packages/agents` TopicExpert + prompts（round1/round2）
21. `packages/agents` Coordinator + prompts（round1/round2）
22. `packages/web-server` MissionOrchestrator + /api/mission/start
23. `packages/web-server` SSE broadcaster + /api/projects/:id/stream
24. `packages/web-ui` ExpertSelector + AgentTimeline + useProjectStream
25. `packages/web-ui` ProjectWorkbench 集成 + MissionCandidateCard + SelectedMissionView
26. 端到端 smoke：MetaNovas Brief 真机跑一遍

---

### Task 1: Monorepo 骨架（pnpm workspace + 3 package）

**Files:**
- Create: `pnpm-workspace.yaml`
- Modify: `package.json`（根）
- Create: `packages/agents/package.json`
- Create: `packages/agents/tsconfig.json`
- Create: `packages/agents/src/index.ts`
- Create: `packages/web-server/package.json`
- Create: `packages/web-server/tsconfig.json`
- Create: `packages/web-server/src/server.ts`
- Create: `packages/web-ui/package.json`
- Create: `packages/web-ui/tsconfig.json`
- Create: `packages/web-ui/vite.config.ts`
- Create: `packages/web-ui/index.html`
- Create: `packages/web-ui/src/main.tsx`

- [ ] **Step 1: 确认根目录已安装 pnpm**

```bash
cd /Users/zeoooo/crossing-writer
pnpm --version
```

如果没有 pnpm：`npm install -g pnpm`

- [ ] **Step 2: 写 `pnpm-workspace.yaml`**

```yaml
packages:
  - 'packages/*'
```

- [ ] **Step 3: 修改根 `package.json`（加 workspaces + dev script）**

Read `package.json` first（SP-01 里可能已经有内容）。如果没有 `package.json`，创建新的：

```json
{
  "name": "crossing-writer",
  "private": true,
  "version": "0.2.0",
  "scripts": {
    "dev": "pnpm -r --parallel --filter=./packages/web-server --filter=./packages/web-ui run dev",
    "build": "pnpm -r run build",
    "test": "pnpm -r run test"
  },
  "devDependencies": {
    "typescript": "^5.4.0"
  },
  "packageManager": "pnpm@9.0.0"
}
```

如果已存在，只需 merge 进 `scripts` 和确保顶级字段 `"private": true`。

- [ ] **Step 4: `packages/agents/package.json`**

```json
{
  "name": "@crossing/agents",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p .",
    "test": "vitest run",
    "dev": "tsc -w -p ."
  },
  "devDependencies": {
    "@types/node": "^20.12.0",
    "typescript": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 5: `packages/agents/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 6: `packages/agents/src/index.ts`**

```ts
export const VERSION = "0.1.0";
```

- [ ] **Step 7: `packages/web-server/package.json`**

```json
{
  "name": "@crossing/web-server",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "build": "tsc -p .",
    "test": "vitest run",
    "dev": "tsx watch src/server.ts"
  },
  "dependencies": {
    "@crossing/agents": "workspace:*",
    "@crossing/kb": "workspace:*",
    "fastify": "^5.0.0",
    "@fastify/multipart": "^9.0.0",
    "@fastify/cors": "^10.0.0",
    "better-sqlite3": "^11.5.0",
    "mammoth": "^1.8.0",
    "pdf-parse": "^1.1.1",
    "@mozilla/readability": "^0.5.0",
    "jsdom": "^25.0.0",
    "yaml": "^2.5.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/jsdom": "^21.1.7",
    "@types/node": "^20.12.0",
    "@types/pdf-parse": "^1.1.4",
    "tsx": "^4.15.0",
    "typescript": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 8: `packages/web-server/tsconfig.json`**

同 agents 的 tsconfig（改 rootDir 即可，一致）。

- [ ] **Step 9: `packages/web-server/src/server.ts`**

```ts
import Fastify from "fastify";

const app = Fastify({ logger: true });

app.get("/api/health", async () => ({ ok: true, ts: Date.now() }));

const PORT = Number(process.env.PORT ?? 3001);

app.listen({ port: PORT, host: "127.0.0.1" })
  .then(() => app.log.info(`listening on :${PORT}`))
  .catch((err) => { app.log.error(err); process.exit(1); });
```

- [ ] **Step 10: `packages/web-ui/package.json`**

```json
{
  "name": "@crossing/web-ui",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-markdown": "^9.0.0",
    "@tanstack/react-query": "^5.50.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.4.0",
    "vite": "^5.4.0",
    "vitest": "^2.0.0",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/vite": "^4.0.0"
  }
}
```

- [ ] **Step 11: `packages/web-ui/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"]
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 12: `packages/web-ui/vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    proxy: {
      "/api": "http://127.0.0.1:3001",
    },
  },
});
```

- [ ] **Step 13: `packages/web-ui/index.html`**

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Crossing Writer</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 14: `packages/web-ui/src/main.tsx`**

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/globals.css";

function App() {
  return <div style={{ padding: 24 }}>Crossing Writer — scaffolded.</div>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 15: `packages/web-ui/src/styles/globals.css`**

```css
@import "tailwindcss";

:root {
  --green: #407600;
  --green-dark: #356200;
  --green-light: #f4f9ed;
  --dark: #1a1a1a;
  --gray: #666;
  --gray-light: #f7f7f7;
  --border: #e5e5e5;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", sans-serif;
  background: #f0f2f5;
  color: var(--dark);
  margin: 0;
}
```

- [ ] **Step 16: 安装依赖**

```bash
cd /Users/zeoooo/crossing-writer
pnpm install
```

Expected: 三个 package 都 link 上，no errors。

- [ ] **Step 17: 验证 web-server 启动**

```bash
pnpm --filter @crossing/web-server dev
```

另开终端：
```bash
curl http://127.0.0.1:3001/api/health
```
Expected: `{"ok":true,"ts":<number>}`

Ctrl-C 停掉。

- [ ] **Step 18: 验证 web-ui 启动**

```bash
pnpm --filter @crossing/web-ui dev
```

浏览器访问 `http://localhost:3000`，应看到 `Crossing Writer — scaffolded.`

Ctrl-C 停掉。

- [ ] **Step 19: Commit**

```bash
cd /Users/zeoooo/crossing-writer
git add pnpm-workspace.yaml package.json packages/agents packages/web-server packages/web-ui
git -c commit.gpgsign=false commit -m "feat(sp-02): monorepo scaffold + three package skeletons"
```

---

### Task 2: `packages/agents` ModelAdapter

**Files:**
- Create: `packages/agents/src/model-adapter.ts`
- Create: `packages/agents/src/config.ts`
- Create: `packages/agents/tests/model-adapter.test.ts`

- [ ] **Step 1: 写 `packages/agents/src/config.ts`**

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

export interface AgentConfig {
  cli: "claude" | "codex";
  model?: string;
}

export interface CrossingConfig {
  vaultPath: string;
  sqlitePath: string;
  modelAdapter: {
    defaultCli: "claude" | "codex";
    fallbackCli: "claude" | "codex";
  };
  agents?: Record<string, AgentConfig>;
}

function expand(p: string): string {
  return p.startsWith("~") ? resolve(homedir(), p.slice(2)) : p;
}

export function loadConfig(path: string): CrossingConfig {
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  return {
    vaultPath: expand(raw.vaultPath),
    sqlitePath: expand(raw.sqlitePath),
    modelAdapter: raw.modelAdapter,
    agents: raw.agents ?? {},
  };
}

export function resolveAgent(cfg: CrossingConfig, key: string): AgentConfig {
  // 精确匹配
  if (cfg.agents?.[key]) return cfg.agents[key];
  // 角色 default（如 "topic_expert.赛博禅心" → "topic_expert.default"）
  const role = key.split(".")[0];
  const defaultKey = `${role}.default`;
  if (cfg.agents?.[defaultKey]) return cfg.agents[defaultKey];
  // 全局 default
  return { cli: cfg.modelAdapter.defaultCli };
}
```

- [ ] **Step 2: 写失败测试 `packages/agents/tests/model-adapter.test.ts`**

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { invokeAgent } from "../src/model-adapter.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawnSync: vi.fn(),
  };
});

import { spawnSync } from "node:child_process";

describe("invokeAgent", () => {
  beforeEach(() => {
    vi.mocked(spawnSync).mockReset();
  });

  it("invokes codex exec with --output-last-message for codex cli", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ma-test-"));
    // simulate codex writing to output file
    vi.mocked(spawnSync).mockImplementation(((cmd: string, args: readonly string[]) => {
      const outIdx = args.indexOf("--output-last-message");
      if (outIdx >= 0) {
        writeFileSync(args[outIdx + 1]!, "mocked response");
      }
      return { status: 0, stdout: Buffer.from(""), stderr: Buffer.from("") } as any;
    }) as any);

    const result = invokeAgent({
      agentKey: "topic_expert.赛博禅心",
      cli: "codex",
      systemPrompt: "you are an expert",
      userMessage: "analyze this brief",
    });

    expect(result.text).toBe("mocked response");
    expect(result.meta.cli).toBe("codex");
    const call = vi.mocked(spawnSync).mock.calls[0]!;
    expect(call[0]).toBe("codex");
    expect(call[1]).toContain("exec");
  });

  it("invokes claude -p for claude cli", () => {
    vi.mocked(spawnSync).mockReturnValue({
      status: 0,
      stdout: Buffer.from("claude response"),
      stderr: Buffer.from(""),
    } as any);

    const result = invokeAgent({
      agentKey: "brief_analyst",
      cli: "claude",
      systemPrompt: "you analyze briefs",
      userMessage: "here is a brief",
    });

    expect(result.text).toBe("claude response");
    const call = vi.mocked(spawnSync).mock.calls[0]!;
    expect(call[0]).toBe("claude");
    expect(call[1]).toContain("-p");
  });

  it("throws on non-zero exit", () => {
    vi.mocked(spawnSync).mockReturnValue({
      status: 1,
      stdout: Buffer.from(""),
      stderr: Buffer.from("auth error"),
    } as any);

    expect(() =>
      invokeAgent({
        agentKey: "x",
        cli: "claude",
        systemPrompt: "",
        userMessage: "",
      }),
    ).toThrow(/auth error/);
  });
});
```

- [ ] **Step 3: 跑测试，预期 fail（没有 model-adapter.ts）**

```bash
cd /Users/zeoooo/crossing-writer/packages/agents && pnpm test
```

Expected: FAIL, "Cannot find module ../src/model-adapter.js"

- [ ] **Step 4: 写 `packages/agents/src/model-adapter.ts`**

```ts
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface InvokeOptions {
  agentKey: string;
  cli: "claude" | "codex";
  systemPrompt: string;
  userMessage: string;
  model?: string;
  timeout?: number;
}

export interface AgentResult {
  text: string;
  meta: { cli: string; model?: string; durationMs: number };
}

export function invokeAgent(opts: InvokeOptions): AgentResult {
  const started = Date.now();
  const timeout = opts.timeout ?? 180_000;
  // Combine system+user into one prompt (both claude/codex take a single prompt arg)
  const fullPrompt = opts.systemPrompt
    ? `${opts.systemPrompt}\n\n---\n\n${opts.userMessage}`
    : opts.userMessage;

  if (opts.cli === "codex") {
    const outPath = join(mkdtempSync(join(tmpdir(), "agent-")), "out.txt");
    const args = [
      "exec",
      "--skip-git-repo-check",
      "--color", "never",
      "--ephemeral",
      "--sandbox", "read-only",
      "--output-last-message", outPath,
      ...(opts.model ? ["-m", opts.model] : []),
      fullPrompt,
    ];
    const proc = spawnSync("codex", args, { encoding: "buffer", timeout });
    if (proc.status !== 0) {
      const err = proc.stderr?.toString("utf-8") ?? "";
      try { unlinkSync(outPath); } catch {}
      throw new Error(`codex exit=${proc.status}: ${err.slice(0, 500)}`);
    }
    const text = readFileSync(outPath, "utf-8");
    try { unlinkSync(outPath); } catch {}
    return {
      text,
      meta: { cli: "codex", model: opts.model, durationMs: Date.now() - started },
    };
  }

  // claude
  const args = [
    "-p", fullPrompt,
    ...(opts.model ? ["--model", opts.model] : []),
  ];
  const proc = spawnSync("claude", args, { encoding: "buffer", timeout });
  if (proc.status !== 0) {
    const err = proc.stderr?.toString("utf-8") ?? "";
    throw new Error(`claude exit=${proc.status}: ${err.slice(0, 500)}`);
  }
  return {
    text: proc.stdout?.toString("utf-8") ?? "",
    meta: { cli: "claude", model: opts.model, durationMs: Date.now() - started },
  };
}
```

- [ ] **Step 5: 跑测试，预期 3 passed**

```bash
cd /Users/zeoooo/crossing-writer/packages/agents && pnpm test
```

- [ ] **Step 6: Commit**

```bash
cd /Users/zeoooo/crossing-writer
git add packages/agents/src/config.ts packages/agents/src/model-adapter.ts packages/agents/tests/model-adapter.test.ts
git -c commit.gpgsign=false commit -m "feat(agents): ModelAdapter with claude/codex subprocess + config resolver"
```

---

### Task 3: `packages/agents` AgentBase + prompt loader

**Files:**
- Create: `packages/agents/src/agent-base.ts`
- Create: `packages/agents/src/prompts/index.ts`
- Create: `packages/agents/src/prompts/brief-analyst.md`
- Create: `packages/agents/tests/agent-base.test.ts`

- [ ] **Step 1: 写失败测试 `packages/agents/tests/agent-base.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { AgentBase } from "../src/agent-base.js";
import * as ma from "../src/model-adapter.js";

describe("AgentBase", () => {
  it("calls invokeAgent with resolved cli and interpolated prompt", () => {
    const spy = vi.spyOn(ma, "invokeAgent").mockReturnValue({
      text: "ok",
      meta: { cli: "claude", durationMs: 10 },
    });

    const agent = new AgentBase({
      key: "brief_analyst",
      systemPromptTemplate: "You are {{role}}.",
      vars: { role: "a Brief Analyst" },
      cli: "claude",
    });

    const out = agent.run("please analyze this");
    expect(out.text).toBe("ok");
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        cli: "claude",
        systemPrompt: "You are a Brief Analyst.",
        userMessage: "please analyze this",
      }),
    );
  });

  it("interpolates multiple variables", () => {
    const spy = vi.spyOn(ma, "invokeAgent").mockReturnValue({
      text: "",
      meta: { cli: "codex", durationMs: 0 },
    });

    const agent = new AgentBase({
      key: "x",
      systemPromptTemplate: "{{a}} and {{b}}",
      vars: { a: "A", b: "B" },
      cli: "codex",
    });
    agent.run("msg");
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ systemPrompt: "A and B" }),
    );
  });
});
```

- [ ] **Step 2: 跑测试，预期 FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/agents && pnpm test
```

- [ ] **Step 3: 写 `packages/agents/src/agent-base.ts`**

```ts
import { invokeAgent, type AgentResult } from "./model-adapter.js";

export interface AgentOptions {
  key: string;
  systemPromptTemplate: string;
  vars?: Record<string, string>;
  cli: "claude" | "codex";
  model?: string;
  timeout?: number;
}

export class AgentBase {
  private opts: AgentOptions;

  constructor(opts: AgentOptions) {
    this.opts = opts;
  }

  protected interpolate(template: string, vars: Record<string, string> = {}): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, name) => vars[name] ?? "");
  }

  run(userMessage: string, extraVars?: Record<string, string>): AgentResult {
    const vars = { ...this.opts.vars, ...extraVars };
    const systemPrompt = this.interpolate(this.opts.systemPromptTemplate, vars);
    return invokeAgent({
      agentKey: this.opts.key,
      cli: this.opts.cli,
      model: this.opts.model,
      systemPrompt,
      userMessage,
      timeout: this.opts.timeout,
    });
  }
}
```

- [ ] **Step 4: 写 prompt loader `packages/agents/src/prompts/index.ts`**

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

export function loadPrompt(name: string): string {
  return readFileSync(join(here, `${name}.md`), "utf-8");
}
```

- [ ] **Step 5: 写占位 prompt `packages/agents/src/prompts/brief-analyst.md`**

```markdown
你是一位 Brief Analyst。读用户提交的甲方 brief，输出结构化的 brief-summary.md。

# 输出要求

严格输出一个 YAML frontmatter + markdown 正文的文档，frontmatter 字段完整见 spec §6.3。

# 输入 brief 原文

{{brief_body}}

# 产品信息补充

{{product_info}}
```

- [ ] **Step 6: 跑测试，预期 2 passed**

```bash
cd /Users/zeoooo/crossing-writer/packages/agents && pnpm test
```

- [ ] **Step 7: Commit**

```bash
cd /Users/zeoooo/crossing-writer
git add packages/agents/src/agent-base.ts packages/agents/src/prompts/ packages/agents/tests/agent-base.test.ts
git -c commit.gpgsign=false commit -m "feat(agents): AgentBase with prompt interpolation + prompt loader"
```

---

### Task 4: `packages/agents` ToolRunner（crossing-kb bash bridge）

让专家 Agent 能调用 `crossing-kb search` 作为逃生舱工具。

**Files:**
- Create: `packages/agents/src/tool-runner.ts`
- Create: `packages/agents/tests/tool-runner.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect, vi } from "vitest";
import { runCrossingKbSearch, parseToolCalls } from "../src/tool-runner.js";
import * as cp from "node:child_process";

vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));

describe("parseToolCalls", () => {
  it("extracts crossing-kb search invocations from agent output", () => {
    const text = `
      Some reasoning...
      \`\`\`tool
      crossing-kb search "agent workflow" --account 量子位 --limit 5
      \`\`\`
      more text
    `;
    const calls = parseToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.command).toBe("crossing-kb");
    expect(calls[0]!.args).toContain("search");
  });

  it("returns empty when no tool blocks", () => {
    expect(parseToolCalls("no tools here")).toEqual([]);
  });
});

describe("runCrossingKbSearch", () => {
  it("invokes crossing-kb CLI with json flag and parses output", () => {
    vi.mocked(cp.spawnSync).mockReturnValue({
      status: 0,
      stdout: Buffer.from(JSON.stringify([{ title: "t", mdPath: "/a.md" }])),
      stderr: Buffer.from(""),
    } as any);
    const result = runCrossingKbSearch(["search", "agent", "--limit", "3"]);
    expect(result.ok).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data![0]!.title).toBe("t");
  });

  it("returns error on non-zero exit", () => {
    vi.mocked(cp.spawnSync).mockReturnValue({
      status: 1,
      stdout: Buffer.from(""),
      stderr: Buffer.from("boom"),
    } as any);
    const result = runCrossingKbSearch(["search", "x"]);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/boom/);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/agents && pnpm test tests/tool-runner.test.ts
```

- [ ] **Step 3: Write `packages/agents/src/tool-runner.ts`**

```ts
import { spawnSync } from "node:child_process";

export interface ToolCall {
  command: string;
  args: string[];
  raw: string;
}

const TOOL_BLOCK = /```tool\n([\s\S]*?)```/g;

export function parseToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const match of text.matchAll(TOOL_BLOCK)) {
    const line = match[1]!.trim();
    if (!line) continue;
    const tokens = tokenize(line);
    if (!tokens.length) continue;
    calls.push({ command: tokens[0]!, args: tokens.slice(1), raw: line });
  }
  return calls;
}

function tokenize(s: string): string[] {
  // simple shell-like tokenizer, supports "double quotes"
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    out.push(m[1] ?? m[2]!);
  }
  return out;
}

export interface ToolResult {
  ok: boolean;
  data?: any;
  error?: string;
}

export function runCrossingKbSearch(args: string[]): ToolResult {
  const fullArgs = [...args];
  if (!fullArgs.includes("--json")) fullArgs.push("--json");
  const proc = spawnSync("crossing-kb", fullArgs, { encoding: "buffer" });
  if (proc.status !== 0) {
    return { ok: false, error: proc.stderr?.toString("utf-8") ?? "" };
  }
  try {
    const data = JSON.parse(proc.stdout?.toString("utf-8") ?? "[]");
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: `parse: ${String(e)}` };
  }
}
```

- [ ] **Step 4: Run, verify pass**

```bash
cd /Users/zeoooo/crossing-writer/packages/agents && pnpm test
```

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer
git add packages/agents/src/tool-runner.ts packages/agents/tests/tool-runner.test.ts
git -c commit.gpgsign=false commit -m "feat(agents): tool-runner for crossing-kb bash bridge"
```

---

### Task 5: `packages/web-server` Fastify 骨架 + config loader

**Files:**
- Modify: `packages/web-server/src/server.ts`
- Create: `packages/web-server/src/config.ts`
- Create: `packages/web-server/tests/config.test.ts`

- [ ] **Step 1: 失败测试 `packages/web-server/tests/config.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadServerConfig } from "../src/config.js";

describe("loadServerConfig", () => {
  it("reads and expands paths from config.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "srv-cfg-"));
    const p = join(dir, "config.json");
    writeFileSync(p, JSON.stringify({
      vaultPath: "~/CrossingVault",
      sqlitePath: "~/CrossingVault/.index/refs.sqlite",
      modelAdapter: { defaultCli: "codex", fallbackCli: "claude" },
    }));
    const cfg = loadServerConfig(p);
    expect(cfg.vaultPath).toMatch(/CrossingVault$/);
    expect(cfg.defaultCli).toBe("codex");
  });

  it("resolves project dir under vault", () => {
    const dir = mkdtempSync(join(tmpdir(), "srv-cfg-"));
    const p = join(dir, "config.json");
    writeFileSync(p, JSON.stringify({
      vaultPath: dir,
      sqlitePath: join(dir, ".index/refs.sqlite"),
      modelAdapter: { defaultCli: "codex", fallbackCli: "claude" },
    }));
    const cfg = loadServerConfig(p);
    expect(cfg.projectsDir).toBe(join(dir, "07_projects"));
    expect(cfg.expertsDir).toBe(join(dir, "08_experts"));
  });
});
```

- [ ] **Step 2: 跑，预期 FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test
```

- [ ] **Step 3: 写 `packages/web-server/src/config.ts`**

```ts
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";

function expand(p: string): string {
  return p.startsWith("~") ? resolve(homedir(), p.slice(2)) : p;
}

export interface ServerConfig {
  vaultPath: string;
  sqlitePath: string;
  projectsDir: string;
  expertsDir: string;
  defaultCli: "claude" | "codex";
  fallbackCli: "claude" | "codex";
  configPath: string;  // for downstream agents.loadConfig
}

export function loadServerConfig(path: string): ServerConfig {
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  const vaultPath = expand(raw.vaultPath);
  return {
    vaultPath,
    sqlitePath: expand(raw.sqlitePath),
    projectsDir: join(vaultPath, "07_projects"),
    expertsDir: join(vaultPath, "08_experts"),
    defaultCli: raw.modelAdapter.defaultCli,
    fallbackCli: raw.modelAdapter.fallbackCli,
    configPath: resolve(path),
  };
}
```

- [ ] **Step 4: 更新 `packages/web-server/src/server.ts`**

```ts
import Fastify from "fastify";
import cors from "@fastify/cors";
import { loadServerConfig } from "./config.js";
import { resolve } from "node:path";

const configPath = process.env.CROSSING_CONFIG
  ?? resolve(process.cwd(), "../../config.json");

export function buildApp() {
  const cfg = loadServerConfig(configPath);
  const app = Fastify({ logger: true });
  app.decorate("crossingConfig", cfg);

  app.register(cors, { origin: true });

  app.get("/api/health", async () => ({
    ok: true,
    vaultPath: cfg.vaultPath,
    ts: Date.now(),
  }));

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    crossingConfig: ReturnType<typeof loadServerConfig>;
  }
}

// entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const app = buildApp();
  const PORT = Number(process.env.PORT ?? 3001);
  app.listen({ port: PORT, host: "127.0.0.1" })
    .then(() => app.log.info(`listening on :${PORT}`))
    .catch((err) => { app.log.error(err); process.exit(1); });
}
```

- [ ] **Step 5: 跑测试 + 手动启动**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test
# 启动
pnpm dev
# 另一终端
curl http://127.0.0.1:3001/api/health
```

Expected: `{"ok":true,"vaultPath":"/Users/zeoooo/CrossingVault","ts":...}`

- [ ] **Step 6: Commit**

```bash
cd /Users/zeoooo/crossing-writer
git add packages/web-server/src/config.ts packages/web-server/src/server.ts packages/web-server/tests/config.test.ts
git -c commit.gpgsign=false commit -m "feat(web-server): config loader + Fastify app with health route"
```

---

### Task 6: `packages/web-server` ProjectStore + events.jsonl

**Files:**
- Create: `packages/web-server/src/services/project-store.ts`
- Create: `packages/web-server/src/services/event-log.ts`
- Create: `packages/web-server/src/state/state-machine.ts`
- Create: `packages/web-server/tests/project-store.test.ts`

- [ ] **Step 1: 失败测试 `packages/web-server/tests/project-store.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/services/project-store.js";
import { appendEvent, readEvents } from "../src/services/event-log.js";

function mkStore(): ProjectStore {
  const root = mkdtempSync(join(tmpdir(), "ps-"));
  return new ProjectStore(root);
}

describe("ProjectStore", () => {
  it("creates a project dir with initial project.json", async () => {
    const store = mkStore();
    const p = await store.create({ name: "Test Project" });
    expect(p.id).toMatch(/^test-project/);
    expect(p.status).toBe("created");
    expect(p.schema_version).toBe(1);
    const file = readFileSync(join(store.projectDir(p.id), "project.json"), "utf-8");
    expect(JSON.parse(file).name).toBe("Test Project");
  });

  it("lists existing projects", async () => {
    const store = mkStore();
    await store.create({ name: "A" });
    await store.create({ name: "B" });
    const list = await store.list();
    expect(list).toHaveLength(2);
    expect(list.map((p) => p.name).sort()).toEqual(["A", "B"]);
  });

  it("updates project fields and bumps updated_at", async () => {
    const store = mkStore();
    const p = await store.create({ name: "X" });
    const before = p.updated_at;
    await new Promise((r) => setTimeout(r, 10));
    await store.update(p.id, { status: "brief_uploaded" });
    const after = await store.get(p.id);
    expect(after!.status).toBe("brief_uploaded");
    expect(after!.updated_at).not.toBe(before);
  });

  it("generates unique slug for name collisions", async () => {
    const store = mkStore();
    const a = await store.create({ name: "Same" });
    const b = await store.create({ name: "Same" });
    expect(a.id).not.toBe(b.id);
  });
});

describe("event-log", () => {
  it("appends and reads events", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ev-"));
    await appendEvent(dir, { type: "state_changed", from: "a", to: "b" });
    await appendEvent(dir, { type: "agent.started", agent: "x" });
    const events = await readEvents(dir);
    expect(events).toHaveLength(2);
    expect(events[0]!.type).toBe("state_changed");
    expect(events[1]!.data.agent).toBe("x");
    expect(events[0]!.ts).toBeTypeOf("string");
  });
});
```

- [ ] **Step 2: 跑，预期 FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test tests/project-store.test.ts
```

- [ ] **Step 3: 写 `packages/web-server/src/state/state-machine.ts`**

```ts
export type ProjectStatus =
  | "created"
  | "brief_uploaded"
  | "brief_analyzing"
  | "brief_ready"
  | "awaiting_expert_selection"
  | "round1_running"
  | "round1_failed"
  | "synthesizing"
  | "round2_running"
  | "round2_failed"
  | "awaiting_mission_pick"
  | "mission_approved";

export type ProjectStage = "intake" | "mission" | "completed";

const TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  created: ["brief_uploaded"],
  brief_uploaded: ["brief_analyzing"],
  brief_analyzing: ["brief_ready", "created"],
  brief_ready: ["awaiting_expert_selection"],
  awaiting_expert_selection: ["round1_running"],
  round1_running: ["synthesizing", "round1_failed"],
  round1_failed: ["round1_running"],
  synthesizing: ["round2_running"],
  round2_running: ["awaiting_mission_pick", "round2_failed"],
  round2_failed: ["round2_running"],
  awaiting_mission_pick: ["mission_approved", "round1_running"],
  mission_approved: [],
};

export function canTransition(from: ProjectStatus, to: ProjectStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function stageOf(status: ProjectStatus): ProjectStage {
  if (status === "mission_approved") return "completed";
  if (status === "created" || status === "brief_uploaded" || status === "brief_analyzing" || status === "brief_ready") return "intake";
  return "mission";
}
```

- [ ] **Step 4: 写 `packages/web-server/src/services/event-log.ts`**

```ts
import { appendFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface StoredEvent {
  ts: string;
  type: string;
  data: Record<string, any>;
}

export async function appendEvent(projectDir: string, event: Record<string, any>): Promise<StoredEvent> {
  await mkdir(projectDir, { recursive: true });
  const { type, ...data } = event;
  const stored: StoredEvent = {
    ts: new Date().toISOString(),
    type: String(type),
    data,
  };
  await appendFile(join(projectDir, "events.jsonl"), JSON.stringify(stored) + "\n", "utf-8");
  return stored;
}

export async function readEvents(projectDir: string): Promise<StoredEvent[]> {
  try {
    const buf = await readFile(join(projectDir, "events.jsonl"), "utf-8");
    return buf
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as StoredEvent);
  } catch (e: any) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
}
```

- [ ] **Step 5: 写 `packages/web-server/src/services/project-store.ts`**

```ts
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectStatus, ProjectStage } from "../state/state-machine.js";

export interface Project {
  id: string;
  name: string;
  slug: string;
  status: ProjectStatus;
  stage: ProjectStage;
  article_type: string | null;
  expected_word_count: number | null;
  deadline: string | null;
  priority: "low" | "normal" | "high";
  tags: string[];
  client: { name: string | null; brand: string | null; product: string | null };
  brief: null | {
    source_type: string;
    raw_path: string;
    md_path: string;
    summary_path: string | null;
    uploaded_at: string;
  };
  product_info: null | {
    name: string | null;
    official_url: string | null;
    trial_url: string | null;
    docs_url: string | null;
    fetched_path: string | null;
    notes: string | null;
  };
  experts_selected: string[];
  mission: {
    candidates_path: string | null;
    selected_index: number | null;
    selected_path: string | null;
    selected_at: string | null;
    selected_by: string | null;
  };
  runs: Array<{
    id: string;
    stage: string;
    started_at: string;
    ended_at: string | null;
    experts: string[];
    status: "running" | "completed" | "failed";
  }>;
  created_at: string;
  updated_at: string;
  schema_version: 1;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w\u4e00-\u9fa5-]+/g, "")
    .slice(0, 60) || "project";
}

export class ProjectStore {
  constructor(private root: string) {}

  projectDir(id: string): string {
    return join(this.root, id);
  }

  async create(input: { name: string }): Promise<Project> {
    const base = slugify(input.name);
    let id = base;
    let n = 1;
    while (await this.exists(id)) {
      n += 1;
      id = `${base}-${n}`;
    }
    const now = new Date().toISOString();
    const p: Project = {
      id,
      name: input.name,
      slug: base,
      status: "created",
      stage: "intake",
      article_type: null,
      expected_word_count: null,
      deadline: null,
      priority: "normal",
      tags: [],
      client: { name: null, brand: null, product: null },
      brief: null,
      product_info: null,
      experts_selected: [],
      mission: {
        candidates_path: null,
        selected_index: null,
        selected_path: null,
        selected_at: null,
        selected_by: null,
      },
      runs: [],
      created_at: now,
      updated_at: now,
      schema_version: 1,
    };
    await mkdir(this.projectDir(id), { recursive: true });
    await writeFile(
      join(this.projectDir(id), "project.json"),
      JSON.stringify(p, null, 2),
      "utf-8",
    );
    return p;
  }

  async exists(id: string): Promise<boolean> {
    try {
      await readFile(join(this.projectDir(id), "project.json"), "utf-8");
      return true;
    } catch { return false; }
  }

  async get(id: string): Promise<Project | null> {
    try {
      const raw = await readFile(join(this.projectDir(id), "project.json"), "utf-8");
      return JSON.parse(raw) as Project;
    } catch (e: any) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
  }

  async list(): Promise<Project[]> {
    try {
      const entries = await readdir(this.root, { withFileTypes: true });
      const out: Project[] = [];
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const p = await this.get(e.name);
        if (p) out.push(p);
      }
      return out.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    } catch (e: any) {
      if (e.code === "ENOENT") return [];
      throw e;
    }
  }

  async update(id: string, patch: Partial<Project>): Promise<Project> {
    const p = await this.get(id);
    if (!p) throw new Error(`project not found: ${id}`);
    const merged: Project = { ...p, ...patch, updated_at: new Date().toISOString() };
    await writeFile(
      join(this.projectDir(id), "project.json"),
      JSON.stringify(merged, null, 2),
      "utf-8",
    );
    return merged;
  }
}
```

- [ ] **Step 6: Run tests, verify PASS**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test
```

- [ ] **Step 7: Commit**

```bash
cd /Users/zeoooo/crossing-writer
git add packages/web-server/src/state/ packages/web-server/src/services/project-store.ts packages/web-server/src/services/event-log.ts packages/web-server/tests/project-store.test.ts
git -c commit.gpgsign=false commit -m "feat(web-server): ProjectStore + event-log + state-machine"
```

---

### Task 7: `/api/projects` CRUD route

**Files:**
- Create: `packages/web-server/src/routes/projects.ts`
- Modify: `packages/web-server/src/server.ts`
- Create: `packages/web-server/tests/routes-projects.test.ts`

- [ ] **Step 1: 失败测试**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { registerProjectsRoutes } from "../src/routes/projects.js";
import { ProjectStore } from "../src/services/project-store.js";

async function mkApp() {
  const vault = mkdtempSync(join(tmpdir(), "vault-"));
  const store = new ProjectStore(join(vault, "07_projects"));
  const app = Fastify();
  registerProjectsRoutes(app, { store });
  await app.ready();
  return { app, store };
}

describe("projects route", () => {
  it("POST /api/projects creates a project", async () => {
    const { app } = await mkApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { name: "New One" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe("New One");
    expect(body.status).toBe("created");
  });

  it("GET /api/projects lists projects", async () => {
    const { app } = await mkApp();
    await app.inject({ method: "POST", url: "/api/projects", payload: { name: "A" } });
    await app.inject({ method: "POST", url: "/api/projects", payload: { name: "B" } });
    const res = await app.inject({ method: "GET", url: "/api/projects" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(2);
  });

  it("GET /api/projects/:id returns details or 404", async () => {
    const { app } = await mkApp();
    const created = (await app.inject({ method: "POST", url: "/api/projects", payload: { name: "X" } })).json();
    const ok = await app.inject({ method: "GET", url: `/api/projects/${created.id}` });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().id).toBe(created.id);
    const miss = await app.inject({ method: "GET", url: "/api/projects/does-not-exist" });
    expect(miss.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test tests/routes-projects.test.ts
```

- [ ] **Step 3: 写 `packages/web-server/src/routes/projects.ts`**

```ts
import type { FastifyInstance } from "fastify";
import type { ProjectStore } from "../services/project-store.js";

export interface ProjectsDeps { store: ProjectStore; }

export function registerProjectsRoutes(app: FastifyInstance, deps: ProjectsDeps) {
  app.get("/api/projects", async () => {
    return deps.store.list();
  });

  app.post<{ Body: { name: string } }>("/api/projects", async (req, reply) => {
    const { name } = req.body ?? ({} as any);
    if (!name || typeof name !== "string" || !name.trim()) {
      return reply.code(400).send({ error: "name required" });
    }
    const p = await deps.store.create({ name: name.trim() });
    return reply.code(201).send(p);
  });

  app.get<{ Params: { id: string } }>("/api/projects/:id", async (req, reply) => {
    const p = await deps.store.get(req.params.id);
    if (!p) return reply.code(404).send({ error: "not found" });
    return p;
  });
}
```

- [ ] **Step 4: 在 `server.ts` 里挂载**

在 `buildApp()` 里，`app.register(cors, ...)` 之后加：

```ts
import { ProjectStore } from "./services/project-store.js";
import { registerProjectsRoutes } from "./routes/projects.js";

// ... inside buildApp()
const store = new ProjectStore(cfg.projectsDir);
app.decorate("projectStore", store);
registerProjectsRoutes(app, { store });
```

并扩展 FastifyInstance declare module 加 `projectStore: ProjectStore`。

- [ ] **Step 5: Run tests**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test
```

- [ ] **Step 6: Smoke via curl（可选）**

```bash
pnpm dev
# 另开终端
curl -X POST http://127.0.0.1:3001/api/projects -H "Content-Type: application/json" -d '{"name":"Smoke"}'
curl http://127.0.0.1:3001/api/projects
```

- [ ] **Step 7: Commit**

```bash
git add packages/web-server/src/routes/projects.ts packages/web-server/src/server.ts packages/web-server/tests/routes-projects.test.ts
git -c commit.gpgsign=false commit -m "feat(web-server): /api/projects CRUD routes"
```

---

### Task 8: file-extractor（docx/pdf/md/txt → md）

**Files:**
- Create: `packages/web-server/src/services/file-extractor.ts`
- Create: `packages/web-server/tests/file-extractor.test.ts`
- Create: `packages/web-server/tests/fixtures/sample.docx`（从网络下载或手工造）
- Create: `packages/web-server/tests/fixtures/sample.pdf`
- Create: `packages/web-server/tests/fixtures/sample.md`
- Create: `packages/web-server/tests/fixtures/sample.txt`

- [ ] **Step 1: 准备 fixtures**

```bash
mkdir -p packages/web-server/tests/fixtures
echo "# Hello from markdown" > packages/web-server/tests/fixtures/sample.md
echo "Plain text content for testing." > packages/web-server/tests/fixtures/sample.txt
# docx: 用 python mammoth 的测试样本；这里简化，跳过 docx 测试 if no fixture
```

对于 docx/pdf fixtures：如果手头没有，用 node 写一个简单 docx 生成器，或直接用真实 brief 文件作为 fixture（后续集成阶段再换）。

**简化路线**：Step 1 只造 md + txt fixture。docx/pdf 的测试用 mock mammoth/pdf-parse。

- [ ] **Step 2: 失败测试 `packages/web-server/tests/file-extractor.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { extractToMarkdown } from "../src/services/file-extractor.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FIX = join(__dirname, "fixtures");

vi.mock("mammoth", () => ({
  default: {
    convertToMarkdown: vi.fn(async () => ({ value: "# docx content\n\nhello" })),
  },
  convertToMarkdown: vi.fn(async () => ({ value: "# docx content\n\nhello" })),
}));

vi.mock("pdf-parse", () => ({
  default: vi.fn(async () => ({ text: "pdf content\n\nmore text" })),
}));

describe("extractToMarkdown", () => {
  it("passes through md files", async () => {
    const buf = readFileSync(join(FIX, "sample.md"));
    const md = await extractToMarkdown(buf, "sample.md");
    expect(md).toMatch(/Hello from markdown/);
  });

  it("wraps txt in minimal markdown", async () => {
    const buf = readFileSync(join(FIX, "sample.txt"));
    const md = await extractToMarkdown(buf, "sample.txt");
    expect(md).toMatch(/Plain text content for testing/);
  });

  it("extracts docx via mammoth", async () => {
    const md = await extractToMarkdown(Buffer.from("fake"), "brief.docx");
    expect(md).toMatch(/docx content/);
  });

  it("extracts pdf via pdf-parse", async () => {
    const md = await extractToMarkdown(Buffer.from("fake"), "brief.pdf");
    expect(md).toMatch(/pdf content/);
  });

  it("throws on unsupported extension", async () => {
    await expect(extractToMarkdown(Buffer.from(""), "bad.jpg")).rejects.toThrow(/unsupported/i);
  });
});
```

- [ ] **Step 3: Run, verify FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test tests/file-extractor.test.ts
```

- [ ] **Step 4: Write `packages/web-server/src/services/file-extractor.ts`**

```ts
import { extname } from "node:path";

export async function extractToMarkdown(buffer: Buffer, filename: string): Promise<string> {
  const ext = extname(filename).toLowerCase();
  switch (ext) {
    case ".md":
    case ".markdown":
      return buffer.toString("utf-8");
    case ".txt":
      return buffer.toString("utf-8");
    case ".docx": {
      const mammoth = (await import("mammoth")).default;
      const result = await mammoth.convertToMarkdown({ buffer });
      return result.value;
    }
    case ".pdf": {
      const pdf = (await import("pdf-parse")).default;
      const result = await pdf(buffer);
      return result.text;
    }
    default:
      throw new Error(`unsupported file type: ${ext}`);
  }
}
```

- [ ] **Step 5: Run tests**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test
```

- [ ] **Step 6: Commit**

```bash
git add packages/web-server/src/services/file-extractor.ts packages/web-server/tests/file-extractor.test.ts packages/web-server/tests/fixtures/
git -c commit.gpgsign=false commit -m "feat(web-server): file-extractor for docx/pdf/md/txt → markdown"
```

---

### Task 9: url-fetcher（readability）

**Files:**
- Create: `packages/web-server/src/services/url-fetcher.ts`
- Create: `packages/web-server/tests/url-fetcher.test.ts`

- [ ] **Step 1: 失败测试**

```ts
import { describe, it, expect, vi } from "vitest";
import { fetchUrlToMarkdown } from "../src/services/url-fetcher.js";

global.fetch = vi.fn();

describe("fetchUrlToMarkdown", () => {
  beforeEach(() => vi.mocked(global.fetch).mockReset());

  it("extracts main content with readability", async () => {
    const html = `<html><head><title>Demo</title></head><body>
      <article><h1>Title</h1><p>main content here is long enough to be extracted by readability quite easily.</p></article>
    </body></html>`;
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => html,
    } as any);
    const md = await fetchUrlToMarkdown("https://example.com/a");
    expect(md).toMatch(/main content here/);
  });

  it("returns empty string warning on 404", async () => {
    vi.mocked(global.fetch).mockResolvedValue({ ok: false, status: 404, text: async () => "" } as any);
    await expect(fetchUrlToMarkdown("https://example.com/x")).rejects.toThrow(/404/);
  });

  it("returns empty flag when readability finds nothing", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true, status: 200, text: async () => "<html></html>",
    } as any);
    const md = await fetchUrlToMarkdown("https://example.com/empty");
    expect(md.trim()).toBe("");
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: 写 `packages/web-server/src/services/url-fetcher.ts`**

```ts
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

export async function fetchUrlToMarkdown(url: string, opts?: { timeoutMs?: number }): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts?.timeoutMs ?? 15_000);
  let res: Response;
  try {
    res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 CrossingWriter" } });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`fetch failed status=${res.status}`);
  const html = await res.text();
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();
  if (!article || !article.textContent) return "";
  const title = article.title ? `# ${article.title}\n\n` : "";
  return `${title}${article.textContent.trim()}`;
}
```

- [ ] **Step 4: Run tests + commit**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test
git add packages/web-server/src/services/url-fetcher.ts packages/web-server/tests/url-fetcher.test.ts
git -c commit.gpgsign=false commit -m "feat(web-server): url-fetcher using readability"
```

---

### Task 10: `/api/projects/:id/brief` 上传 route

**Files:**
- Create: `packages/web-server/src/routes/brief.ts`
- Modify: `packages/web-server/src/server.ts`
- Create: `packages/web-server/tests/routes-brief.test.ts`

- [ ] **Step 1: 失败测试**

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { registerProjectsRoutes } from "../src/routes/projects.js";
import { registerBriefRoutes } from "../src/routes/brief.js";
import { ProjectStore } from "../src/services/project-store.js";

async function mkApp() {
  const vault = mkdtempSync(join(tmpdir(), "vault-"));
  const projectsDir = join(vault, "07_projects");
  const store = new ProjectStore(projectsDir);
  const app = Fastify();
  await app.register(multipart);
  registerProjectsRoutes(app, { store });
  registerBriefRoutes(app, { store, projectsDir });
  await app.ready();
  const created = (await app.inject({ method: "POST", url: "/api/projects", payload: { name: "T" } })).json();
  return { app, store, project: created, projectsDir };
}

describe("brief route", () => {
  it("accepts plain text brief and saves brief.md + updates project status", async () => {
    const { app, store, project, projectsDir } = await mkApp();
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/brief`,
      payload: {
        text: "# Brief\n\nHello world.",
        productName: "ACME",
        productUrl: null,
        notes: "urgent",
      },
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(200);
    const updated = await store.get(project.id);
    expect(updated!.status).toBe("brief_uploaded");
    expect(updated!.brief!.source_type).toBe("text");
    const mdPath = join(projectsDir, project.id, updated!.brief!.md_path);
    expect(existsSync(mdPath)).toBe(true);
    expect(readFileSync(mdPath, "utf-8")).toMatch(/Hello world/);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: 写 `packages/web-server/src/routes/brief.ts`**

```ts
import type { FastifyInstance } from "fastify";
import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectStore } from "../services/project-store.js";
import { extractToMarkdown } from "../services/file-extractor.js";
import { appendEvent } from "../services/event-log.js";

export interface BriefDeps { store: ProjectStore; projectsDir: string; }

interface TextBody {
  text?: string;
  productName?: string | null;
  productUrl?: string | null;
  productDocsUrl?: string | null;
  productTrialUrl?: string | null;
  notes?: string | null;
}

export function registerBriefRoutes(app: FastifyInstance, deps: BriefDeps) {
  // JSON body (粘贴文本路径)
  app.post<{ Params: { id: string }; Body: TextBody }>(
    "/api/projects/:id/brief",
    async (req, reply) => {
      const { id } = req.params;
      const project = await deps.store.get(id);
      if (!project) return reply.code(404).send({ error: "project not found" });

      const ct = req.headers["content-type"] ?? "";
      const projectDir = join(deps.projectsDir, id);
      const briefDir = join(projectDir, "brief");
      const rawDir = join(briefDir, "raw");
      await mkdir(rawDir, { recursive: true });

      let sourceType = "text";
      let rawPath = "";
      let markdown = "";

      if (ct.startsWith("multipart/form-data")) {
        const data = await req.file();
        if (!data) return reply.code(400).send({ error: "no file" });
        sourceType = data.filename.split(".").pop()!.toLowerCase();
        rawPath = join("brief/raw", data.filename);
        const abs = join(projectDir, rawPath);
        const buf = await data.toBuffer();
        await writeFile(abs, buf);
        markdown = await extractToMarkdown(buf, data.filename);
      } else {
        const body = req.body ?? ({} as TextBody);
        if (!body.text) return reply.code(400).send({ error: "text required" });
        markdown = body.text;
        rawPath = "brief/raw/brief.txt";
        await writeFile(join(projectDir, rawPath), body.text, "utf-8");
      }

      const mdRel = "brief/brief.md";
      await writeFile(join(projectDir, mdRel), markdown, "utf-8");

      const now = new Date().toISOString();
      const body = (req.body ?? {}) as TextBody;
      await deps.store.update(id, {
        status: "brief_uploaded",
        brief: {
          source_type: sourceType,
          raw_path: rawPath,
          md_path: mdRel,
          summary_path: null,
          uploaded_at: now,
        },
        product_info: {
          name: body.productName ?? null,
          official_url: body.productUrl ?? null,
          trial_url: body.productTrialUrl ?? null,
          docs_url: body.productDocsUrl ?? null,
          fetched_path: null,
          notes: body.notes ?? null,
        },
      });

      await appendEvent(projectDir, {
        type: "state_changed",
        from: project.status,
        to: "brief_uploaded",
      });

      return reply.send({ ok: true });
    },
  );
}
```

- [ ] **Step 4: 在 `server.ts` 里注册 multipart 和 brief route**

```ts
import multipart from "@fastify/multipart";
import { registerBriefRoutes } from "./routes/brief.js";

// in buildApp, after cors:
await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } });
registerBriefRoutes(app, { store, projectsDir: cfg.projectsDir });
```

- [ ] **Step 5: Run tests, commit**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test
git add packages/web-server/src/routes/brief.ts packages/web-server/src/server.ts packages/web-server/tests/routes-brief.test.ts
git -c commit.gpgsign=false commit -m "feat(web-server): POST /api/projects/:id/brief (text + file upload)"
```

---

### Task 11: BriefAnalyst role + prompt

**Files:**
- Create: `packages/agents/src/roles/brief-analyst.ts`
- Modify: `packages/agents/src/prompts/brief-analyst.md`（替换 Task 3 的占位）
- Create: `packages/agents/tests/brief-analyst.test.ts`

- [ ] **Step 1: 替换 `prompts/brief-analyst.md` 成完整 prompt**

```markdown
你是 Crossing Writer 系统的 Brief Analyst Agent。读甲方 Brief 原文，输出一份严格结构化的 brief-summary.md。

# 硬性要求

输出**必须**是一个合法的 YAML frontmatter + markdown 正文的 md 文档，不要任何额外 markdown 代码围栏，不要任何注释或说明。

frontmatter 字段见下面模板，不能漏，不能多，必填字段若信息缺失填 `null`。

# 输出模板

```
---
type: brief_summary
project_id: {{project_id}}
generated_by: brief_analyst
generated_at: {{now}}
model_used: {{model_used}}

client: <甲方公司名 or null>
brand: <品牌名 or null>
product: <产品名 or null>
product_category: <一句话品类>
product_stage: <prelaunch | launched | iteration | end-of-life or null>

goal: <一句话传播目标>
goal_kind: <awareness | conversion | retention | thought_leadership>
audience:
  primary: <主要读者>
  secondary: <次要读者 or null>
  persona_keywords: ["...", "..."]

key_messages:
  - "..."
value_props:
  - "..."
forbidden_claims:
  - "..."
must_cover_points:
  - "..."
avoid_angles:
  - "..."

tone:
  voice: <语气关键词>
  forbidden_words: ["..."]
  preferred_words: ["..."]
style_reference: <null or 已知品牌名>

required_deliverables:
  - format: <wechat_article | x_thread | video_script | ...>
    word_count_range: [min, max]
    with_images: <true | false>
deadline: <YYYY-MM-DD or null>
deadline_strictness: <soft | hard>

gap_notes:
  - "<信息缺口描述>"
confidence: <0-1 浮点>
---

# Brief 摘要

<300 字段落式自然语言总结，覆盖客户、产品、传播目的、读者、关键信息、禁区、语气、交付。>

## 原始 Brief 关键片段

> <引用 3-5 段 brief 里最关键的原文>

## Brief Analyst 的判断

<1-2 段对这个 brief 的独立评估：传播难度、潜在陷阱、建议优先探索的角度。>
```

# 输入

## Brief 原文

{{brief_body}}

## 产品信息补充（用户在表单填的 + URL 抓取的）

{{product_info}}

## 项目上下文

- project_id: {{project_id}}
- now: {{now}}
- model_used: {{model_used}}
```

- [ ] **Step 2: 失败测试 `packages/agents/tests/brief-analyst.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { BriefAnalyst } from "../src/roles/brief-analyst.js";
import * as ma from "../src/model-adapter.js";

describe("BriefAnalyst", () => {
  it("runs with interpolated prompt and returns text", () => {
    const spy = vi.spyOn(ma, "invokeAgent").mockReturnValue({
      text: "---\ntype: brief_summary\n---\n# done",
      meta: { cli: "claude", durationMs: 10 },
    });
    const analyst = new BriefAnalyst({ cli: "claude" });
    const out = analyst.analyze({
      projectId: "p1",
      briefBody: "Brief body",
      productInfo: "Product X",
    });
    expect(out.text).toMatch(/brief_summary/);
    const call = spy.mock.calls[0]![0] as any;
    expect(call.systemPrompt).toMatch(/Brief body/);
    expect(call.systemPrompt).toMatch(/Product X/);
    expect(call.systemPrompt).toMatch(/p1/);
  });
});
```

- [ ] **Step 3: 跑，预期 FAIL**

- [ ] **Step 4: 写 `packages/agents/src/roles/brief-analyst.ts`**

```ts
import { AgentBase } from "../agent-base.js";
import { loadPrompt } from "../prompts/index.js";

export interface BriefAnalyzeInput {
  projectId: string;
  briefBody: string;
  productInfo: string;
}

export class BriefAnalyst {
  private base: AgentBase;

  constructor(opts: { cli: "claude" | "codex"; model?: string }) {
    const template = loadPrompt("brief-analyst");
    this.base = new AgentBase({
      key: "brief_analyst",
      systemPromptTemplate: template,
      vars: {},
      cli: opts.cli,
      model: opts.model,
    });
  }

  analyze(input: BriefAnalyzeInput) {
    return this.base.run("", {
      project_id: input.projectId,
      now: new Date().toISOString(),
      model_used: "auto",
      brief_body: input.briefBody,
      product_info: input.productInfo,
    });
  }
}
```

- [ ] **Step 5: Run tests + commit**

```bash
cd /Users/zeoooo/crossing-writer/packages/agents && pnpm test
git add packages/agents/src/roles/brief-analyst.ts packages/agents/src/prompts/brief-analyst.md packages/agents/tests/brief-analyst.test.ts
git -c commit.gpgsign=false commit -m "feat(agents): BriefAnalyst role + structured prompt"
```

---

### Task 12: brief-analyzer-service + trigger on upload

**Files:**
- Create: `packages/web-server/src/services/brief-analyzer-service.ts`
- Modify: `packages/web-server/src/routes/brief.ts`（上传成功后异步触发）
- Create: `packages/web-server/src/routes/brief-summary.ts`
- Create: `packages/web-server/tests/brief-analyzer-service.test.ts`

- [ ] **Step 1: 失败测试**

```ts
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/services/project-store.js";
import { analyzeBrief } from "../src/services/brief-analyzer-service.js";
import * as briefAnalyst from "@crossing/agents";

vi.mock("@crossing/agents", async () => {
  const actual = await vi.importActual<any>("@crossing/agents");
  return {
    ...actual,
    BriefAnalyst: vi.fn().mockImplementation(() => ({
      analyze: vi.fn().mockReturnValue({
        text: "---\ntype: brief_summary\nproject_id: p1\n---\n# summary\n\nOK.",
        meta: { cli: "codex", durationMs: 100 },
      }),
    })),
  };
});

describe("analyzeBrief", () => {
  it("reads brief.md, runs analyst, writes brief-summary.md, updates status", async () => {
    const vault = mkdtempSync(join(tmpdir(), "ana-"));
    const projectsDir = join(vault, "07_projects");
    const store = new ProjectStore(projectsDir);
    const p = await store.create({ name: "X" });
    const projectDir = join(projectsDir, p.id);
    require("node:fs").mkdirSync(join(projectDir, "brief"), { recursive: true });
    writeFileSync(join(projectDir, "brief/brief.md"), "brief body", "utf-8");
    await store.update(p.id, {
      status: "brief_uploaded",
      brief: { source_type: "text", raw_path: "brief/raw/brief.txt", md_path: "brief/brief.md", summary_path: null, uploaded_at: "" },
    });

    await analyzeBrief({
      projectId: p.id,
      projectsDir,
      store,
      cli: "codex",
    });

    const updated = await store.get(p.id);
    expect(updated!.status).toBe("brief_ready");
    expect(updated!.brief!.summary_path).toBe("brief/brief-summary.md");
    const summary = readFileSync(join(projectDir, "brief/brief-summary.md"), "utf-8");
    expect(summary).toMatch(/brief_summary/);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: 写 `packages/web-server/src/services/brief-analyzer-service.ts`**

```ts
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BriefAnalyst } from "@crossing/agents";
import type { ProjectStore } from "./project-store.js";
import { appendEvent } from "./event-log.js";

export interface AnalyzeBriefOpts {
  projectId: string;
  projectsDir: string;
  store: ProjectStore;
  cli: "claude" | "codex";
  model?: string;
}

export async function analyzeBrief(opts: AnalyzeBriefOpts): Promise<void> {
  const { projectId, projectsDir, store, cli, model } = opts;
  const project = await store.get(projectId);
  if (!project || !project.brief) throw new Error("no brief to analyze");

  const projectDir = join(projectsDir, projectId);
  await appendEvent(projectDir, { type: "state_changed", from: project.status, to: "brief_analyzing" });
  await store.update(projectId, { status: "brief_analyzing" });
  await appendEvent(projectDir, { type: "agent.started", agent: "brief_analyst" });

  try {
    const briefBody = await readFile(join(projectDir, project.brief.md_path), "utf-8");
    const productInfo = JSON.stringify(project.product_info ?? {}, null, 2);
    const analyst = new BriefAnalyst({ cli, model });
    const result = analyst.analyze({
      projectId,
      briefBody,
      productInfo,
    });

    const summaryPath = "brief/brief-summary.md";
    await writeFile(join(projectDir, summaryPath), result.text, "utf-8");

    await store.update(projectId, {
      status: "brief_ready",
      brief: { ...project.brief, summary_path: summaryPath },
    });
    await appendEvent(projectDir, {
      type: "agent.completed",
      agent: "brief_analyst",
      output: summaryPath,
    });
    await appendEvent(projectDir, { type: "state_changed", from: "brief_analyzing", to: "brief_ready" });
  } catch (e: any) {
    await appendEvent(projectDir, {
      type: "agent.failed",
      agent: "brief_analyst",
      error: String(e),
    });
    // revert status so user can retry
    await store.update(projectId, { status: "brief_uploaded" });
    throw e;
  }
}
```

- [ ] **Step 4: 在 `brief.ts` route 里成功响应前异步 fire-and-forget**

在 Task 10 的 brief route 里，`await deps.store.update(...)` 之后，触发分析但不等：

```ts
import { analyzeBrief } from "../services/brief-analyzer-service.js";

// 在 update 之后：
// 异步分析（failures 只写 events.jsonl，不阻塞响应）
setImmediate(() => {
  analyzeBrief({
    projectId: id,
    projectsDir: deps.projectsDir,
    store: deps.store,
    cli: deps.cli,
    model: deps.model,
  }).catch((err) => app.log.error({ err, projectId: id }, "analyzeBrief failed"));
});
```

route 需要依赖注入 cli/model，把这两个也加到 `BriefDeps` 里，在 server.ts 注册时从 `cfg.defaultCli` 传入。

- [ ] **Step 5: 加 `GET /api/projects/:id/brief-summary` route（读文件）**

在同一个 brief route 里追加：

```ts
import { readFile } from "node:fs/promises";

app.get<{ Params: { id: string } }>(
  "/api/projects/:id/brief-summary",
  async (req, reply) => {
    const project = await deps.store.get(req.params.id);
    if (!project || !project.brief?.summary_path) {
      return reply.code(404).send({ error: "no summary yet" });
    }
    const buf = await readFile(
      join(deps.projectsDir, req.params.id, project.brief.summary_path),
      "utf-8",
    );
    reply.header("content-type", "text/markdown; charset=utf-8");
    return buf;
  },
);
```

- [ ] **Step 6: Run tests + commit**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test
git add packages/web-server/src/services/brief-analyzer-service.ts packages/web-server/src/routes/brief.ts packages/web-server/tests/brief-analyzer-service.test.ts
git -c commit.gpgsign=false commit -m "feat(web-server): brief-analyzer-service with async trigger + summary route"
```

---

### Task 13: `packages/web-ui` tokens + routing skeleton

**Files:**
- Create: `packages/web-ui/src/styles/tokens.css`
- Modify: `packages/web-ui/src/App.tsx`
- Modify: `packages/web-ui/src/main.tsx`
- Create: `packages/web-ui/src/pages/ProjectList.tsx`（占位）
- Create: `packages/web-ui/src/pages/ProjectWorkbench.tsx`（占位）

- [ ] **Step 1: 装 react-router 和 query**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-ui
pnpm add react-router-dom@^6.26.0
```

- [ ] **Step 2: `styles/tokens.css`**

```css
:root {
  --green: #407600;
  --green-dark: #356200;
  --green-light: #f4f9ed;
  --green-border: #c5e0a5;
  --dark: #1a1a1a;
  --gray: #666;
  --gray-light: #f7f7f7;
  --border: #e5e5e5;
  --danger: #d32;
}
```

- [ ] **Step 3: 更新 `globals.css`**

```css
@import "tailwindcss";
@import "./tokens.css";

body { background: #f0f2f5; color: var(--dark); margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", sans-serif; }
* { box-sizing: border-box; }
```

- [ ] **Step 4: 写 `App.tsx`**

```tsx
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProjectList } from "./pages/ProjectList";
import { ProjectWorkbench } from "./pages/ProjectWorkbench";

const qc = new QueryClient();

export function App() {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<ProjectList />} />
          <Route path="/projects/:id" element={<ProjectWorkbench />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
```

- [ ] **Step 5: 更新 `main.tsx`**

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/globals.css";
import { App } from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 6: 占位 pages**

`pages/ProjectList.tsx`:
```tsx
export function ProjectList() {
  return <div className="p-6 text-2xl">Project List (stub)</div>;
}
```

`pages/ProjectWorkbench.tsx`:
```tsx
import { useParams } from "react-router-dom";
export function ProjectWorkbench() {
  const { id } = useParams();
  return <div className="p-6">Workbench for {id} (stub)</div>;
}
```

- [ ] **Step 7: 启动验证**

```bash
cd /Users/zeoooo/crossing-writer && pnpm dev
```
浏览器 `localhost:3000`：看到"Project List (stub)"；手动 `/projects/test-id`：看到"Workbench for test-id"。

- [ ] **Step 8: Commit**

```bash
git add packages/web-ui/
git -c commit.gpgsign=false commit -m "feat(web-ui): tokens + router + page stubs"
```

---

### Task 14: API client + types

**Files:**
- Create: `packages/web-ui/src/api/types.ts`
- Create: `packages/web-ui/src/api/client.ts`
- Create: `packages/web-ui/src/hooks/useProjects.ts`

- [ ] **Step 1: `api/types.ts`**

```ts
export type ProjectStatus =
  | "created" | "brief_uploaded" | "brief_analyzing" | "brief_ready"
  | "awaiting_expert_selection" | "round1_running" | "round1_failed"
  | "synthesizing" | "round2_running" | "round2_failed"
  | "awaiting_mission_pick" | "mission_approved";

export interface Project {
  id: string;
  name: string;
  slug: string;
  status: ProjectStatus;
  stage: "intake" | "mission" | "completed";
  article_type: string | null;
  experts_selected: string[];
  brief: null | { source_type: string; raw_path: string; md_path: string; summary_path: string | null; uploaded_at: string };
  product_info: null | Record<string, any>;
  mission: { candidates_path: string | null; selected_index: number | null; selected_path: string | null; selected_at: string | null; selected_by: string | null };
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface Expert {
  name: string;
  file: string;
  active: boolean;
  default_preselect: boolean;
  specialty: string;
}
```

- [ ] **Step 2: `api/client.ts`**

```ts
import type { Project, Expert } from "./types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return res.json() as Promise<T>;
  return res.text() as unknown as Promise<T>;
}

export const api = {
  listProjects: () => request<Project[]>("/api/projects"),
  createProject: (name: string) =>
    request<Project>("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  getProject: (id: string) => request<Project>(`/api/projects/${id}`),
  uploadBriefText: (id: string, body: { text: string; productName?: string; productUrl?: string; notes?: string }) =>
    request<{ ok: true }>(`/api/projects/${id}/brief`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  uploadBriefFile: (id: string, file: File, extra: { productName?: string; productUrl?: string; notes?: string }) => {
    const fd = new FormData();
    fd.append("file", file);
    for (const [k, v] of Object.entries(extra)) {
      if (v) fd.append(k, v);
    }
    return fetch(`/api/projects/${id}/brief`, { method: "POST", body: fd }).then((r) => {
      if (!r.ok) throw new Error(`${r.status}`);
      return r.json();
    });
  },
  getBriefSummary: (id: string) => request<string>(`/api/projects/${id}/brief-summary`),
  listExperts: () => request<Expert[]>("/api/experts"),
};
```

- [ ] **Step 3: `hooks/useProjects.ts`**

```ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

export function useProjects() {
  return useQuery({ queryKey: ["projects"], queryFn: api.listProjects });
}

export function useProject(id: string | undefined) {
  return useQuery({
    queryKey: ["projects", id],
    queryFn: () => api.getProject(id!),
    enabled: !!id,
    refetchInterval: 5000,
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createProject,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/web-ui/src/api packages/web-ui/src/hooks/useProjects.ts
git -c commit.gpgsign=false commit -m "feat(web-ui): API client + types + project hooks"
```

---

### Task 15: ProjectList page + new project flow

**Files:**
- Modify: `packages/web-ui/src/pages/ProjectList.tsx`

- [ ] **Step 1: 写 `ProjectList.tsx`**

```tsx
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useProjects, useCreateProject } from "../hooks/useProjects";

export function ProjectList() {
  const { data, isLoading } = useProjects();
  const create = useCreateProject();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [showNew, setShowNew] = useState(false);

  async function handleCreate() {
    if (!name.trim()) return;
    const p = await create.mutateAsync(name.trim());
    navigate(`/projects/${p.id}`);
  }

  return (
    <div className="max-w-5xl mx-auto p-8">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold" style={{ color: "var(--green)" }}>
          Crossing Writer
        </h1>
        <button
          onClick={() => setShowNew(true)}
          className="px-4 py-2 rounded text-white"
          style={{ background: "var(--green)" }}
        >
          新建项目
        </button>
      </header>

      {showNew && (
        <div className="mb-6 p-4 bg-white rounded border" style={{ borderColor: "var(--border)" }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="项目名"
            className="w-full p-2 border rounded mb-3"
          />
          <div className="flex gap-2">
            <button onClick={handleCreate} className="px-4 py-2 rounded text-white" style={{ background: "var(--green)" }}>创建</button>
            <button onClick={() => setShowNew(false)} className="px-4 py-2 rounded border">取消</button>
          </div>
        </div>
      )}

      {isLoading ? (
        <p>加载中…</p>
      ) : data?.length ? (
        <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
          {data.map((p) => (
            <li key={p.id} className="py-4">
              <Link to={`/projects/${p.id}`} className="block hover:bg-gray-50 rounded p-2">
                <div className="font-medium">{p.name}</div>
                <div className="text-sm text-gray-600">
                  {p.stage} · {p.status} · {new Date(p.updated_at).toLocaleString()}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-gray-500">还没有项目</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 启动验证**

```bash
pnpm dev
```
浏览器点"新建项目" → 输入名字 → 创建 → 跳转 workbench。

- [ ] **Step 3: Commit**

```bash
git add packages/web-ui/src/pages/ProjectList.tsx
git -c commit.gpgsign=false commit -m "feat(web-ui): ProjectList page + new project modal"
```

---

### Task 16: BriefIntakeForm component

**Files:**
- Create: `packages/web-ui/src/components/right/BriefIntakeForm.tsx`
- Modify: `packages/web-ui/src/pages/ProjectWorkbench.tsx`

- [ ] **Step 1: 写 `BriefIntakeForm.tsx`**

```tsx
import { useState } from "react";
import { api } from "../../api/client";

export function BriefIntakeForm({ projectId, onUploaded }: { projectId: string; onUploaded: () => void }) {
  const [mode, setMode] = useState<"text" | "file">("text");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [productName, setProductName] = useState("");
  const [productUrl, setProductUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      if (mode === "text") {
        if (!text.trim()) throw new Error("Brief 文本不能为空");
        await api.uploadBriefText(projectId, { text, productName, productUrl, notes });
      } else {
        if (!file) throw new Error("请选择文件");
        await api.uploadBriefFile(projectId, file, { productName, productUrl, notes });
      }
      onUploaded();
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 p-4 bg-white rounded border" style={{ borderColor: "var(--border)" }}>
      <h2 className="font-semibold">上传 Brief</h2>

      <div className="flex gap-2">
        <button onClick={() => setMode("text")} className={`px-3 py-1 rounded border ${mode === "text" ? "bg-[var(--green-light)] border-[var(--green)]" : ""}`}>粘贴文本</button>
        <button onClick={() => setMode("file")} className={`px-3 py-1 rounded border ${mode === "file" ? "bg-[var(--green-light)] border-[var(--green)]" : ""}`}>上传文件</button>
      </div>

      {mode === "text" ? (
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} className="w-full border rounded p-2" placeholder="粘贴 Brief 原文…" />
      ) : (
        <input type="file" accept=".docx,.pdf,.md,.txt" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      )}

      <div className="space-y-2">
        <label className="block text-sm">产品名（可选）</label>
        <input value={productName} onChange={(e) => setProductName(e.target.value)} className="w-full border rounded p-2" />
        <label className="block text-sm mt-2">产品官网 URL（可选）</label>
        <input value={productUrl} onChange={(e) => setProductUrl(e.target.value)} className="w-full border rounded p-2" />
        <label className="block text-sm mt-2">备注（可选）</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full border rounded p-2" />
      </div>

      {err && <div className="text-red-600 text-sm">{err}</div>}

      <button onClick={submit} disabled={busy} className="px-4 py-2 rounded text-white" style={{ background: "var(--green)" }}>
        {busy ? "上传中…" : "开始解析 Brief"}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: 在 `ProjectWorkbench.tsx` 简单集成**

```tsx
import { useParams } from "react-router-dom";
import { useProject } from "../hooks/useProjects";
import { BriefIntakeForm } from "../components/right/BriefIntakeForm";
import ReactMarkdown from "react-markdown";

export function ProjectWorkbench() {
  const { id } = useParams<{ id: string }>();
  const { data: project, refetch } = useProject(id);

  if (!project) return <div className="p-6">加载中…</div>;

  return (
    <div className="h-screen flex flex-col">
      <header className="p-4 border-b bg-white flex items-center gap-3" style={{ borderColor: "var(--border)" }}>
        <a href="/" className="text-sm text-gray-500">← 列表</a>
        <h1 className="font-semibold">{project.name}</h1>
        <span className="text-xs px-2 py-0.5 rounded bg-gray-100">{project.status}</span>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* 左侧：草稿区 */}
        <div className="w-3/5 border-r overflow-auto p-6" style={{ borderColor: "var(--border)" }}>
          {project.status === "created" || project.status === "brief_uploaded" ? (
            <div className="text-gray-500">等待 Brief 解析完成…</div>
          ) : (
            <BriefSummaryPane projectId={project.id} />
          )}
        </div>

        {/* 右侧：工作区 */}
        <div className="w-2/5 overflow-auto p-6 bg-[var(--gray-light)]">
          {project.status === "created" && (
            <BriefIntakeForm projectId={project.id} onUploaded={() => refetch()} />
          )}
          {(project.status === "brief_uploaded" || project.status === "brief_analyzing") && (
            <div className="p-4 bg-white rounded border">Brief Analyst 运行中…</div>
          )}
        </div>
      </div>
    </div>
  );
}

function BriefSummaryPane({ projectId }: { projectId: string }) {
  const { data } = useBriefSummary(projectId);
  if (!data) return <div className="text-gray-500">加载摘要中…</div>;
  return <div className="prose max-w-none"><ReactMarkdown>{data}</ReactMarkdown></div>;
}

function useBriefSummary(id: string) {
  // 简单实现，useQuery
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useQuery } = require("@tanstack/react-query");
  const { api } = require("../api/client");
  return useQuery({ queryKey: ["brief-summary", id], queryFn: () => api.getBriefSummary(id), retry: false });
}
```

（注意：`useBriefSummary` 的 require 是权宜写法，Task 后期可提到 hooks 目录。）

- [ ] **Step 3: Commit**

```bash
git add packages/web-ui/src/components/right/BriefIntakeForm.tsx packages/web-ui/src/pages/ProjectWorkbench.tsx
git -c commit.gpgsign=false commit -m "feat(web-ui): BriefIntakeForm + Workbench split-pane integration"
```

---

### Task 17: 拷贝 ai-kepu-panel 到 vault + 写 index.yaml

**Files:**
- 在 vault 创建：`~/CrossingVault/08_experts/topic-panel/SKILL.md`、`experts/*_kb.md`、`index.yaml`
- 无代码改动

- [ ] **Step 1: 建目录**

```bash
mkdir -p ~/CrossingVault/08_experts/topic-panel/experts
```

- [ ] **Step 2: 拷贝**

```bash
cp /Users/zeoooo/Downloads/ai-kepu-panel/SKILL.md ~/CrossingVault/08_experts/topic-panel/SKILL.md
cp /Users/zeoooo/Downloads/ai-kepu-panel/expert_knowledge/*.md ~/CrossingVault/08_experts/topic-panel/experts/
```

验证：
```bash
ls ~/CrossingVault/08_experts/topic-panel/experts/ | wc -l
```
Expected: 10

- [ ] **Step 3: 手写 `index.yaml`**

```bash
cat > ~/CrossingVault/08_experts/topic-panel/index.yaml <<'EOF'
experts:
  - name: 赛博禅心
    file: experts/赛博禅心_kb.md
    active: true
    default_preselect: true
    specialty: 用写史记的方式写 AI，跨领域映射，极高信息密度
  - name: 数字生命卡兹克
    file: experts/数字生命卡兹克_kb.md
    active: true
    default_preselect: true
    specialty: 游戏玩家审美 + Prompt 方法论 + 个人感悟型爆款
  - name: 苍何
    file: experts/苍何_kb.md
    active: true
    default_preselect: false
    specialty: 自嘲式热血技术宅，保姆级教程
  - name: AGENT橘
    file: experts/AGENT橘_kb.md
    active: true
    default_preselect: false
    specialty: 创业前线 AI 布道者，旧世界 vs 新世界框架
  - name: AI产品阿颖
    file: experts/AI产品阿颖_kb.md
    active: true
    default_preselect: false
    specialty: 产品经理视角 + 生活化类比 + 情感共鸣式评测
  - name: AI产品黄叔
    file: experts/AI产品黄叔_kb.md
    active: true
    default_preselect: false
    specialty: 非技术人群入门导师
  - name: 卡尔的AI沃茨
    file: experts/卡尔的AI沃茨_kb.md
    active: true
    default_preselect: false
    specialty: 邪修玩法实测大哥，降门槛教程
  - name: 硅星人Pro
    file: experts/硅星人Pro_kb.md
    active: true
    default_preselect: false
    specialty: 记者+分析师 深度行业分析 token 经济学
  - name: 袋鼠帝AI客栈
    file: experts/袋鼠帝AI客栈_kb.md
    active: true
    default_preselect: false
    specialty: 技术宅实测日记，国产 AI 优先
  - name: 逛逛GitHub
    file: experts/逛逛GitHub_kb.md
    active: true
    default_preselect: false
    specialty: 淘宝直播语感推荐开源项目，Star 数据驱动
EOF
```

- [ ] **Step 4: 此步骤无 git commit**（vault 不进 git），但记录 commit 标记这一步完成：

```bash
cd /Users/zeoooo/crossing-writer
cat > docs/superpowers/notes/sp02-vault-setup.md <<'EOF'
# SP-02 Vault setup
- 08_experts/topic-panel/ 已从 /Users/zeoooo/Downloads/ai-kepu-panel 拷入 10 位专家 KB
- index.yaml 已生成（2 位默认预选）
- 08_experts/style-panel/十字路口_kb.md 已在 SP-02 brainstorm 期间创建
EOF
git add docs/superpowers/notes/sp02-vault-setup.md
git -c commit.gpgsign=false commit -m "docs: record SP-02 vault setup (experts copied from ai-kepu-panel)"
```

---

### Task 18: ExpertRegistry service + /api/experts route

**Files:**
- Create: `packages/web-server/src/services/expert-registry.ts`
- Create: `packages/web-server/src/routes/experts.ts`
- Modify: `packages/web-server/src/server.ts`
- Create: `packages/web-server/tests/expert-registry.test.ts`

- [ ] **Step 1: 失败测试**

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExpertRegistry } from "../src/services/expert-registry.js";

function mkRegistry() {
  const dir = mkdtempSync(join(tmpdir(), "exp-"));
  const topicDir = join(dir, "topic-panel");
  mkdirSync(join(topicDir, "experts"), { recursive: true });
  writeFileSync(join(topicDir, "index.yaml"), `
experts:
  - name: A
    file: experts/A_kb.md
    active: true
    default_preselect: true
    specialty: aa
  - name: B
    file: experts/B_kb.md
    active: true
    default_preselect: false
    specialty: bb
  - name: C
    file: experts/C_kb.md
    active: false
    default_preselect: false
    specialty: cc
`);
  writeFileSync(join(topicDir, "experts/A_kb.md"), "# A kb");
  writeFileSync(join(topicDir, "experts/B_kb.md"), "# B kb");
  return new ExpertRegistry(dir);
}

describe("ExpertRegistry", () => {
  it("lists active experts with KB path resolution", () => {
    const r = mkRegistry();
    const experts = r.listActive("topic-panel");
    expect(experts.map((e) => e.name).sort()).toEqual(["A", "B"]);
  });

  it("returns default preselected names", () => {
    const r = mkRegistry();
    expect(r.defaultPreselected("topic-panel")).toEqual(["A"]);
  });

  it("reads KB contents", () => {
    const r = mkRegistry();
    const kb = r.readKb("topic-panel", "A");
    expect(kb).toMatch(/A kb/);
  });

  it("throws for unknown expert", () => {
    const r = mkRegistry();
    expect(() => r.readKb("topic-panel", "Z")).toThrow(/not found/);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: 写 `packages/web-server/src/services/expert-registry.ts`**

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

export interface ExpertEntry {
  name: string;
  file: string;
  active: boolean;
  default_preselect: boolean;
  specialty: string;
}

export class ExpertRegistry {
  constructor(private expertsRootDir: string) {}

  private loadIndex(panel: string): ExpertEntry[] {
    const raw = readFileSync(join(this.expertsRootDir, panel, "index.yaml"), "utf-8");
    const data = parseYaml(raw) as { experts: ExpertEntry[] };
    return data.experts ?? [];
  }

  listAll(panel: string): ExpertEntry[] {
    return this.loadIndex(panel);
  }

  listActive(panel: string): ExpertEntry[] {
    return this.loadIndex(panel).filter((e) => e.active);
  }

  defaultPreselected(panel: string): string[] {
    return this.listActive(panel).filter((e) => e.default_preselect).map((e) => e.name);
  }

  readKb(panel: string, name: string): string {
    const entry = this.listAll(panel).find((e) => e.name === name);
    if (!entry) throw new Error(`expert not found: ${name}`);
    return readFileSync(join(this.expertsRootDir, panel, entry.file), "utf-8");
  }
}
```

- [ ] **Step 4: 写 route `packages/web-server/src/routes/experts.ts`**

```ts
import type { FastifyInstance } from "fastify";
import type { ExpertRegistry } from "../services/expert-registry.js";

export function registerExpertsRoutes(app: FastifyInstance, deps: { registry: ExpertRegistry }) {
  app.get("/api/experts", async () => {
    const topic = deps.registry.listActive("topic-panel");
    const preselected = deps.registry.defaultPreselected("topic-panel");
    return {
      topic_panel: topic.map((e) => ({ ...e, default_preselect: preselected.includes(e.name) })),
    };
  });
}
```

- [ ] **Step 5: 挂载进 server.ts**

```ts
import { ExpertRegistry } from "./services/expert-registry.js";
import { registerExpertsRoutes } from "./routes/experts.js";

const registry = new ExpertRegistry(cfg.expertsDir);
app.decorate("expertRegistry", registry);
registerExpertsRoutes(app, { registry });
```

- [ ] **Step 6: Run tests + commit**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test
git add packages/web-server/src/services/expert-registry.ts packages/web-server/src/routes/experts.ts packages/web-server/src/server.ts packages/web-server/tests/expert-registry.test.ts
git -c commit.gpgsign=false commit -m "feat(web-server): ExpertRegistry + /api/experts route"
```

---

### Task 19: refs-fetcher service（生成 refs-pack.md）

**Files:**
- Create: `packages/web-server/src/services/refs-fetcher.ts`
- Create: `packages/web-server/tests/refs-fetcher.test.ts`

- [ ] **Step 1: 失败测试**

```ts
import { describe, it, expect, vi } from "vitest";
import { buildRefsPack } from "../src/services/refs-fetcher.js";

vi.mock("@crossing/kb", () => ({
  searchRefs: vi.fn(),
}));
import * as kb from "@crossing/kb";

describe("buildRefsPack", () => {
  it("aggregates search results into a dedup'd markdown pack", () => {
    vi.mocked(kb.searchRefs).mockImplementation((ctx: any, opts: any) => {
      if (opts.query === "agent workflow") {
        return [
          { id: "1", title: "A1", account: "量子位", publishedAt: "2025-06-01", summary: "a", mdPath: "/p/a.md", score: 0, topicsCore: [], topicsFine: [], author: null, snippet: "", url: "u1", wordCount: null },
          { id: "2", title: "A2", account: "智东西", publishedAt: "2025-06-02", summary: "b", mdPath: "/p/b.md", score: 0, topicsCore: [], topicsFine: [], author: null, snippet: "", url: "u2", wordCount: null },
        ] as any;
      }
      if (opts.query === "多 Agent") {
        return [
          { id: "2", title: "A2", account: "智东西", publishedAt: "2025-06-02", summary: "b", mdPath: "/p/b.md", score: 0, topicsCore: [], topicsFine: [], author: null, snippet: "", url: "u2", wordCount: null },
          { id: "3", title: "A3", account: "硅星人Pro", publishedAt: "2025-06-03", summary: "c", mdPath: "/p/c.md", score: 0, topicsCore: [], topicsFine: [], author: null, snippet: "", url: "u3", wordCount: null },
        ] as any;
      }
      return [] as any;
    });

    const md = buildRefsPack({
      ctx: { sqlitePath: "/x", vaultPath: "/v" },
      queries: ["agent workflow", "多 Agent", "nothing"],
      limitPerQuery: 10,
      totalLimit: 30,
    });
    expect(md).toMatch(/A1/);
    expect(md).toMatch(/A2/);
    expect(md).toMatch(/A3/);
    // A2 出现两次但只记一次
    expect((md.match(/A2/g) ?? []).length).toBe(1);
  });
});
```

- [ ] **Step 2: 写 `packages/web-server/src/services/refs-fetcher.ts`**

```ts
import { searchRefs, type SearchCtx, type SearchResult } from "@crossing/kb";

export interface BuildRefsPackOpts {
  ctx: SearchCtx;
  queries: string[];
  limitPerQuery?: number;
  totalLimit?: number;
}

export function buildRefsPack(opts: BuildRefsPackOpts): string {
  const perQuery = opts.limitPerQuery ?? 10;
  const total = opts.totalLimit ?? 30;
  const seen = new Set<string>();
  const items: Array<SearchResult & { matchedQuery: string }> = [];

  for (const q of opts.queries) {
    if (!q.trim()) continue;
    const hits = searchRefs(opts.ctx, { query: q, limit: perQuery });
    for (const h of hits) {
      if (seen.has(h.id)) continue;
      seen.add(h.id);
      items.push({ ...h, matchedQuery: q });
      if (items.length >= total) break;
    }
    if (items.length >= total) break;
  }

  const lines: string[] = [];
  lines.push(`---\ntype: refs_pack\ngenerated_at: ${new Date().toISOString()}\nqueries: [${opts.queries.map((q) => JSON.stringify(q)).join(", ")}]\ntotal: ${items.length}\n---\n`);
  lines.push(`# Refs Pack (Top ${items.length})\n`);
  for (const [i, it] of items.entries()) {
    lines.push(`## ${i + 1}. ${it.title}`);
    lines.push(`- account: ${it.account}`);
    lines.push(`- published_at: ${it.publishedAt}`);
    lines.push(`- url: ${it.url}`);
    lines.push(`- md_path: ${it.mdPath}`);
    lines.push(`- matched_query: "${it.matchedQuery}"`);
    if (it.summary) lines.push(`- summary: ${it.summary}`);
    lines.push("");
  }
  return lines.join("\n");
}
```

- [ ] **Step 3: Run tests + commit**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test
git add packages/web-server/src/services/refs-fetcher.ts packages/web-server/tests/refs-fetcher.test.ts
git -c commit.gpgsign=false commit -m "feat(web-server): refs-fetcher builds shared context pack from refs.sqlite"
```

---

### Task 20: TopicExpert agent + prompts (round1 / round2)

**Files:**
- Create: `packages/agents/src/roles/topic-expert.ts`
- Create: `packages/agents/src/prompts/topic-expert-round1.md`
- Create: `packages/agents/src/prompts/topic-expert-round2.md`
- Create: `packages/agents/tests/topic-expert.test.ts`

- [ ] **Step 1: `prompts/topic-expert-round1.md`**

```markdown
你是 {{expert_name}}。以下是你的写作风格与选题口味知识库——你是这样写文章的：

---
{{kb_content}}
---

# 当前任务

你作为选题评审团的一员，独立（其他专家看不到你的输出）评估这份 brief，用你自己的风格和选题口味判断。

# 输入

## Brief 摘要

{{brief_summary}}

## 历史参考材料 pack（共享）

{{refs_pack}}

## 可选工具：

如果上面的 refs-pack 不够，你可以在输出里用 ```tool 代码块调用：

```tool
crossing-kb search "关键词" --account 账号名 --since 2025-01 --limit 5
```

我会帮你执行并把结果回塞给你下一轮推理。如无需要，不用调用。

# 输出要求

严格输出一个 YAML frontmatter + markdown 正文的文档，结构如下：

```
---
type: expert_round1
expert: {{expert_name}}
project_id: {{project_id}}
run_id: {{run_id}}
kb_source: {{kb_source}}
model_used: {{model_used}}
started_at: {{now}}

brief_score: <1-10>
brief_confidence: <0-1>
viability_flags:
  - "<若干条短语>"

refs_queries_made: []
refs_cited: []

angles:
  - name: "<角度短标题>"
    seed_claim: "<一句话命题雏形>"
    rationale: "<为什么从你风格出发这是好角度>"
    fit_score: <1-10>
    risk: "<最大风险>"
  - name: ...
    ...
  - name: ...
    ...
---

# 我对这个选题的看法

<300-500 字完整思考>
```

不要输出任何其他解释文字。
```

- [ ] **Step 2: `prompts/topic-expert-round2.md`**

```markdown
你是 {{expert_name}}，基于以下风格/口味：

---
{{kb_content}}
---

# Round 2 任务

Coordinator 综合各专家 Round 1 意见，合成了 3 个候选 Mission。你现在独立打分：

## 候选列表

{{candidates_md}}

# 输出要求

严格输出 YAML frontmatter + markdown 正文：

```
---
type: expert_round2
expert: {{expert_name}}
project_id: {{project_id}}
run_id: {{run_id}}
kb_source: {{kb_source}}
model_used: {{model_used}}
started_at: {{now}}

scores:
  - candidate_index: 1
    score: <1-10>
    strengths: ["..."]
    weaknesses: ["..."]
    fatal_risk: "<最致命的一个风险>"
    would_pick: <true | false>
  - candidate_index: 2
    ...
  - candidate_index: 3
    ...

overall_recommendation: <1 | 2 | 3>
---

# 综合判断
<200-400 字>
```
```

- [ ] **Step 3: 失败测试**

```ts
import { describe, it, expect, vi } from "vitest";
import { TopicExpert } from "../src/roles/topic-expert.js";
import * as ma from "../src/model-adapter.js";

describe("TopicExpert", () => {
  it("runs round1 with KB embedded in prompt", () => {
    const spy = vi.spyOn(ma, "invokeAgent").mockReturnValue({ text: "---\ntype: expert_round1\n---\n", meta: { cli: "claude", durationMs: 5 } });
    const expert = new TopicExpert({
      name: "赛博禅心",
      kbContent: "## kb style\nDeep analytical",
      kbSource: "08_experts/topic-panel/experts/赛博禅心_kb.md",
      cli: "claude",
    });
    expert.round1({
      projectId: "p1",
      runId: "run-1",
      briefSummary: "brief summary",
      refsPack: "refs pack",
    });
    const call = spy.mock.calls[0]![0] as any;
    expect(call.systemPrompt).toMatch(/赛博禅心/);
    expect(call.systemPrompt).toMatch(/Deep analytical/);
    expect(call.systemPrompt).toMatch(/brief summary/);
    expect(call.systemPrompt).toMatch(/refs pack/);
  });

  it("runs round2 with candidates injected", () => {
    const spy = vi.spyOn(ma, "invokeAgent").mockReturnValue({ text: "---\ntype: expert_round2\n---\n", meta: { cli: "claude", durationMs: 5 } });
    const expert = new TopicExpert({
      name: "X", kbContent: "kb", kbSource: "f.md", cli: "claude",
    });
    expert.round2({
      projectId: "p1",
      runId: "run-1",
      candidatesMd: "# 候选 1\n...\n# 候选 2\n...",
    });
    const call = spy.mock.calls[0]![0] as any;
    expect(call.systemPrompt).toMatch(/候选 1/);
  });
});
```

- [ ] **Step 4: 写 `packages/agents/src/roles/topic-expert.ts`**

```ts
import { AgentBase } from "../agent-base.js";
import { loadPrompt } from "../prompts/index.js";

export interface TopicExpertOpts {
  name: string;
  kbContent: string;
  kbSource: string;
  cli: "claude" | "codex";
  model?: string;
}

export interface Round1Input {
  projectId: string;
  runId: string;
  briefSummary: string;
  refsPack: string;
}

export interface Round2Input {
  projectId: string;
  runId: string;
  candidatesMd: string;
}

export class TopicExpert {
  constructor(private opts: TopicExpertOpts) {}

  private baseVars() {
    return {
      expert_name: this.opts.name,
      kb_content: this.opts.kbContent,
      kb_source: this.opts.kbSource,
      model_used: this.opts.model ?? "auto",
      now: new Date().toISOString(),
    };
  }

  round1(input: Round1Input) {
    const template = loadPrompt("topic-expert-round1");
    const base = new AgentBase({
      key: `topic_expert.${this.opts.name}`,
      systemPromptTemplate: template,
      vars: {
        ...this.baseVars(),
        project_id: input.projectId,
        run_id: input.runId,
        brief_summary: input.briefSummary,
        refs_pack: input.refsPack,
      },
      cli: this.opts.cli,
      model: this.opts.model,
    });
    return base.run("");
  }

  round2(input: Round2Input) {
    const template = loadPrompt("topic-expert-round2");
    const base = new AgentBase({
      key: `topic_expert.${this.opts.name}`,
      systemPromptTemplate: template,
      vars: {
        ...this.baseVars(),
        project_id: input.projectId,
        run_id: input.runId,
        candidates_md: input.candidatesMd,
      },
      cli: this.opts.cli,
      model: this.opts.model,
    });
    return base.run("");
  }
}
```

- [ ] **Step 5: Run tests + commit**

```bash
cd /Users/zeoooo/crossing-writer/packages/agents && pnpm test
git add packages/agents/src/roles/topic-expert.ts packages/agents/src/prompts/topic-expert-round1.md packages/agents/src/prompts/topic-expert-round2.md packages/agents/tests/topic-expert.test.ts
git -c commit.gpgsign=false commit -m "feat(agents): TopicExpert role with round1/round2 prompts"
```

---

### Task 21: Coordinator agent + prompts

**Files:**
- Create: `packages/agents/src/roles/coordinator.ts`
- Create: `packages/agents/src/prompts/coordinator-round1.md`
- Create: `packages/agents/src/prompts/coordinator-round2.md`
- Create: `packages/agents/tests/coordinator.test.ts`

- [ ] **Step 1: `prompts/coordinator-round1.md`**

```markdown
你是 Crossing Writer 的 Mission Coordinator。读甲方 brief 摘要和 N 位专家 Round 1 的独立意见（他们互相看不到对方），合成 **3 个候选 Mission**。

# 输入

## Brief 摘要
{{brief_summary}}

## 历史参考材料 pack
{{refs_pack}}

## 专家 Round 1 意见
{{round1_bundle}}

# 合成原则

- 不要照搬任何单个专家的意见；吸收多家优点并规避各家短板
- 3 个候选应**角度差异明显**（不要 3 个都是同一个切入）
- 每个候选都必须能被 brief 支撑（不能凭空创造）
- 参考 refs_pack 里的历史文章作对比论据

# 输出格式

严格输出 YAML frontmatter + markdown：

```
---
type: mission_candidates
project_id: {{project_id}}
run_id: {{run_id}}
generated_by: coordinator
generated_at: {{now}}
model_used: {{model_used}}
experts_round1: {{experts_list_json}}
---

# 候选 1
## 元数据
- 角度名称: ...
- 文章类型: ...
- 推荐标题方向:
  - "..."
- 综合评分: null  # round2 再填

## Mission 字段
- primary_claim: ...
- secondary_claims:
  - ...
- must_cover:
  - ...
- avoid:
  - ...
- recommended_structure: "..."
- target_audience_fit: <0-1>

## 支撑论据（来自 Brief + refs-pack）
- ...
- ...

## Round 2 评审摘要
（此段 round2 结束后由 Coordinator 回填，当前留空）

# 候选 2
...

# 候选 3
...
```
```

- [ ] **Step 2: `prompts/coordinator-round2.md`**

```markdown
你是 Mission Coordinator。Round 2 各位专家已独立打分。把 Round 2 结果聚合回 candidates.md。

# 当前 candidates.md 原文
{{candidates_md}}

# Round 2 专家打分 bundle
{{round2_bundle}}

# 任务

1. 计算每个候选的 aggregate_score（所有专家打分的平均）
2. 按 aggregate_score 降序，确定 final_order
3. 在每个候选的 `## Round 2 评审摘要` 段落下填入：
   - 每位专家的评分 + 风险一句话
4. 更新 frontmatter 加入：
   - experts_round2: [...]
   - round2_rankings: [{candidate_index, aggregate_score}, ...]
   - final_order: [N, N, N]

严格输出更新后的完整 candidates.md，保持结构不变。不要任何解释。
```

- [ ] **Step 3: 失败测试 `tests/coordinator.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { Coordinator } from "../src/roles/coordinator.js";
import * as ma from "../src/model-adapter.js";

describe("Coordinator", () => {
  it("round1 synth: passes all inputs to prompt", () => {
    const spy = vi.spyOn(ma, "invokeAgent").mockReturnValue({ text: "---\ntype: mission_candidates\n---", meta: { cli: "claude", durationMs: 5 } });
    const c = new Coordinator({ cli: "claude" });
    c.round1Synthesize({
      projectId: "p1",
      runId: "r1",
      briefSummary: "B",
      refsPack: "R",
      round1Bundle: "EXPERT1\n\nEXPERT2",
      experts: ["A", "B"],
    });
    const call = spy.mock.calls[0]![0] as any;
    expect(call.systemPrompt).toMatch(/EXPERT1/);
    expect(call.systemPrompt).toMatch(/EXPERT2/);
    expect(call.systemPrompt).toMatch(/p1/);
  });

  it("round2 aggregate: embeds candidates.md and round2 bundle", () => {
    const spy = vi.spyOn(ma, "invokeAgent").mockReturnValue({ text: "---\n---", meta: { cli: "claude", durationMs: 5 } });
    const c = new Coordinator({ cli: "claude" });
    c.round2Aggregate({
      candidatesMd: "CANDIDATES_ORIGINAL",
      round2Bundle: "R2_BUNDLE",
    });
    const call = spy.mock.calls[0]![0] as any;
    expect(call.systemPrompt).toMatch(/CANDIDATES_ORIGINAL/);
    expect(call.systemPrompt).toMatch(/R2_BUNDLE/);
  });
});
```

- [ ] **Step 4: 写 `packages/agents/src/roles/coordinator.ts`**

```ts
import { AgentBase } from "../agent-base.js";
import { loadPrompt } from "../prompts/index.js";

export interface CoordinatorOpts {
  cli: "claude" | "codex";
  model?: string;
}

export interface Round1SynthInput {
  projectId: string;
  runId: string;
  briefSummary: string;
  refsPack: string;
  round1Bundle: string;
  experts: string[];
}

export interface Round2AggregateInput {
  candidatesMd: string;
  round2Bundle: string;
}

export class Coordinator {
  constructor(private opts: CoordinatorOpts) {}

  round1Synthesize(input: Round1SynthInput) {
    const template = loadPrompt("coordinator-round1");
    const base = new AgentBase({
      key: "coordinator",
      systemPromptTemplate: template,
      vars: {
        project_id: input.projectId,
        run_id: input.runId,
        now: new Date().toISOString(),
        model_used: this.opts.model ?? "auto",
        brief_summary: input.briefSummary,
        refs_pack: input.refsPack,
        round1_bundle: input.round1Bundle,
        experts_list_json: JSON.stringify(input.experts),
      },
      cli: this.opts.cli,
      model: this.opts.model,
    });
    return base.run("");
  }

  round2Aggregate(input: Round2AggregateInput) {
    const template = loadPrompt("coordinator-round2");
    const base = new AgentBase({
      key: "coordinator",
      systemPromptTemplate: template,
      vars: {
        candidates_md: input.candidatesMd,
        round2_bundle: input.round2Bundle,
      },
      cli: this.opts.cli,
      model: this.opts.model,
    });
    return base.run("");
  }
}
```

- [ ] **Step 5: 导出 agents 包的公共符号**

在 `packages/agents/src/index.ts` 里：

```ts
export { BriefAnalyst } from "./roles/brief-analyst.js";
export { TopicExpert } from "./roles/topic-expert.js";
export { Coordinator } from "./roles/coordinator.js";
export { invokeAgent } from "./model-adapter.js";
export { AgentBase } from "./agent-base.js";
export { loadConfig, resolveAgent } from "./config.js";
export type { AgentConfig, CrossingConfig } from "./config.js";
export const VERSION = "0.2.0";
```

- [ ] **Step 6: Run tests + commit**

```bash
cd /Users/zeoooo/crossing-writer/packages/agents && pnpm test
git add packages/agents/src/roles/coordinator.ts packages/agents/src/prompts/coordinator-*.md packages/agents/tests/coordinator.test.ts packages/agents/src/index.ts
git -c commit.gpgsign=false commit -m "feat(agents): Coordinator with round1 synth + round2 aggregate prompts"
```

---

### Task 22: MissionOrchestrator + /api/mission/start route

编排 round1 并行 → Coordinator 合成 → round2 并行 → Coordinator 聚合。

**Files:**
- Create: `packages/web-server/src/services/mission-orchestrator.ts`
- Create: `packages/web-server/src/routes/mission.ts`
- Modify: `packages/web-server/src/server.ts`
- Create: `packages/web-server/tests/mission-orchestrator.test.ts`

- [ ] **Step 1: 失败测试（mock agents 包）**

```ts
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/services/project-store.js";
import { ExpertRegistry } from "../src/services/expert-registry.js";
import { runMission } from "../src/services/mission-orchestrator.js";

vi.mock("@crossing/agents", () => ({
  TopicExpert: vi.fn().mockImplementation((opts: any) => ({
    round1: vi.fn().mockReturnValue({ text: `---\ntype: expert_round1\nexpert: ${opts.name}\n---\n# round1 ${opts.name}`, meta: { cli: "codex", durationMs: 10 } }),
    round2: vi.fn().mockReturnValue({ text: `---\ntype: expert_round2\nexpert: ${opts.name}\n---\n# round2 ${opts.name}`, meta: { cli: "codex", durationMs: 10 } }),
  })),
  Coordinator: vi.fn().mockImplementation(() => ({
    round1Synthesize: vi.fn().mockReturnValue({ text: "---\ntype: mission_candidates\n---\n# 候选 1\n# 候选 2\n# 候选 3", meta: { cli: "claude", durationMs: 10 } }),
    round2Aggregate: vi.fn().mockReturnValue({ text: "---\ntype: mission_candidates\nround2_rankings: [{candidate_index: 2, aggregate_score: 8.5}]\n---\n# 候选 1\n# 候选 2\n# 候选 3", meta: { cli: "claude", durationMs: 10 } }),
  })),
}));

vi.mock("../src/services/refs-fetcher.js", () => ({
  buildRefsPack: vi.fn().mockReturnValue("mock refs pack"),
}));

function mkEnv() {
  const vault = mkdtempSync(join(tmpdir(), "mo-"));
  const projectsDir = join(vault, "07_projects");
  const expertsRoot = join(vault, "08_experts");
  mkdirSync(join(expertsRoot, "topic-panel/experts"), { recursive: true });
  writeFileSync(join(expertsRoot, "topic-panel/index.yaml"), `
experts:
  - { name: A, file: experts/A.md, active: true, default_preselect: true, specialty: x }
  - { name: B, file: experts/B.md, active: true, default_preselect: true, specialty: y }
`);
  writeFileSync(join(expertsRoot, "topic-panel/experts/A.md"), "# A kb");
  writeFileSync(join(expertsRoot, "topic-panel/experts/B.md"), "# B kb");
  return {
    store: new ProjectStore(projectsDir),
    registry: new ExpertRegistry(expertsRoot),
    projectsDir,
  };
}

describe("runMission", () => {
  it("orchestrates round1 → synth → round2 → aggregate end-to-end with mocks", async () => {
    const { store, registry, projectsDir } = mkEnv();
    const p = await store.create({ name: "T" });
    const projectDir = join(projectsDir, p.id);
    mkdirSync(join(projectDir, "brief"), { recursive: true });
    writeFileSync(join(projectDir, "brief/brief-summary.md"), "---\nproduct: X\n---\n# summary", "utf-8");
    await store.update(p.id, {
      status: "brief_ready",
      brief: { source_type: "text", raw_path: "r", md_path: "brief/brief.md", summary_path: "brief/brief-summary.md", uploaded_at: "" },
    });

    await runMission({
      projectId: p.id,
      experts: ["A", "B"],
      store,
      registry,
      projectsDir,
      cli: "codex",
      searchCtx: { sqlitePath: "/x", vaultPath: "/v" },
    });

    const updated = await store.get(p.id);
    expect(updated!.status).toBe("awaiting_mission_pick");
    expect(readFileSync(join(projectDir, "mission/candidates.md"), "utf-8")).toMatch(/mission_candidates/);
    expect(readFileSync(join(projectDir, "mission/round1/A.md"), "utf-8")).toMatch(/round1 A/);
    expect(readFileSync(join(projectDir, "mission/round2/B.md"), "utf-8")).toMatch(/round2 B/);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: 写 `packages/web-server/src/services/mission-orchestrator.ts`**

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TopicExpert, Coordinator } from "@crossing/agents";
import type { SearchCtx } from "@crossing/kb";
import type { ProjectStore } from "./project-store.js";
import type { ExpertRegistry } from "./expert-registry.js";
import { appendEvent } from "./event-log.js";
import { buildRefsPack } from "./refs-fetcher.js";

export interface RunMissionOpts {
  projectId: string;
  experts: string[];
  store: ProjectStore;
  registry: ExpertRegistry;
  projectsDir: string;
  cli: "claude" | "codex";
  model?: string;
  searchCtx: SearchCtx;
}

function bundle(entries: Array<{ name: string; text: string }>): string {
  return entries.map((e) => `# === ${e.name} ===\n\n${e.text}`).join("\n\n---\n\n");
}

export async function runMission(opts: RunMissionOpts): Promise<void> {
  const { projectId, experts, store, registry, projectsDir, cli, model, searchCtx } = opts;
  const project = await store.get(projectId);
  if (!project) throw new Error("project not found");
  if (!project.brief?.summary_path) throw new Error("brief summary missing");

  const projectDir = join(projectsDir, projectId);
  const runId = `run-${Date.now()}`;
  const briefSummary = await readFile(join(projectDir, project.brief.summary_path), "utf-8");

  // enter round1
  await store.update(projectId, {
    status: "round1_running",
    experts_selected: experts,
    runs: [...(project.runs ?? []), { id: runId, stage: "mission", started_at: new Date().toISOString(), ended_at: null, experts, status: "running" }],
  });
  await appendEvent(projectDir, { type: "state_changed", from: project.status, to: "round1_running" });

  // build refs-pack (simple query extraction from brief-summary)
  const queries = extractQueries(briefSummary);
  const refsPack = buildRefsPack({ ctx: searchCtx, queries, limitPerQuery: 10, totalLimit: 30 });
  await mkdir(join(projectDir, "context"), { recursive: true });
  await writeFile(join(projectDir, "context/refs-pack.md"), refsPack, "utf-8");
  await appendEvent(projectDir, { type: "refs_pack.generated", queries, total: refsPack.split("## ").length - 1 });

  // round1 parallel
  await mkdir(join(projectDir, "mission/round1"), { recursive: true });
  const round1Results: Array<{ name: string; text: string }> = [];
  await Promise.all(
    experts.map(async (name) => {
      await appendEvent(projectDir, { type: "expert.round1_started", expert: name });
      const kbContent = registry.readKb("topic-panel", name);
      const entry = registry.listAll("topic-panel").find((e) => e.name === name)!;
      const agent = new TopicExpert({ name, kbContent, kbSource: `08_experts/topic-panel/${entry.file}`, cli, model });
      const out = agent.round1({ projectId, runId, briefSummary, refsPack });
      await writeFile(join(projectDir, `mission/round1/${name}.md`), out.text, "utf-8");
      round1Results.push({ name, text: out.text });
      await appendEvent(projectDir, { type: "expert.round1_completed", expert: name });
    }),
  );

  // coordinator synthesize
  await store.update(projectId, { status: "synthesizing" });
  await appendEvent(projectDir, { type: "state_changed", from: "round1_running", to: "synthesizing" });
  await appendEvent(projectDir, { type: "coordinator.synthesizing" });
  const coord = new Coordinator({ cli, model });
  const candidatesResult = coord.round1Synthesize({
    projectId,
    runId,
    briefSummary,
    refsPack,
    round1Bundle: bundle(round1Results),
    experts,
  });
  const candidatesPath = "mission/candidates.md";
  await writeFile(join(projectDir, candidatesPath), candidatesResult.text, "utf-8");
  await appendEvent(projectDir, { type: "coordinator.candidates_ready", output_path: candidatesPath });

  // round2 parallel
  await store.update(projectId, { status: "round2_running" });
  await appendEvent(projectDir, { type: "state_changed", from: "synthesizing", to: "round2_running" });
  await mkdir(join(projectDir, "mission/round2"), { recursive: true });
  const round2Results: Array<{ name: string; text: string }> = [];
  await Promise.all(
    experts.map(async (name) => {
      await appendEvent(projectDir, { type: "expert.round2_started", expert: name });
      const kbContent = registry.readKb("topic-panel", name);
      const entry = registry.listAll("topic-panel").find((e) => e.name === name)!;
      const agent = new TopicExpert({ name, kbContent, kbSource: `08_experts/topic-panel/${entry.file}`, cli, model });
      const out = agent.round2({ projectId, runId, candidatesMd: candidatesResult.text });
      await writeFile(join(projectDir, `mission/round2/${name}.md`), out.text, "utf-8");
      round2Results.push({ name, text: out.text });
      await appendEvent(projectDir, { type: "expert.round2_completed", expert: name });
    }),
  );

  // coordinator aggregate
  await appendEvent(projectDir, { type: "coordinator.aggregating" });
  const aggregated = coord.round2Aggregate({
    candidatesMd: candidatesResult.text,
    round2Bundle: bundle(round2Results),
  });
  await writeFile(join(projectDir, candidatesPath), aggregated.text, "utf-8");

  // done
  const final = await store.get(projectId);
  await store.update(projectId, {
    status: "awaiting_mission_pick",
    mission: { ...final!.mission, candidates_path: candidatesPath },
    runs: [...(final!.runs ?? []).slice(0, -1), { ...final!.runs!.at(-1)!, status: "completed", ended_at: new Date().toISOString() }],
  });
  await appendEvent(projectDir, { type: "state_changed", from: "round2_running", to: "awaiting_mission_pick" });
}

function extractQueries(briefSummary: string): string[] {
  // 粗暴版本：从 frontmatter 抠出 brand / product / key_messages；后续可用 yaml lib 精细化
  const queries: string[] = [];
  const match = (re: RegExp) => {
    const m = briefSummary.match(re);
    return m?.[1]?.trim();
  };
  const brand = match(/^brand:\s*(.+)$/m);
  const product = match(/^product:\s*(.+)$/m);
  const productCat = match(/^product_category:\s*(.+)$/m);
  if (brand && brand !== "null") queries.push(brand);
  if (product && product !== "null") queries.push(product);
  if (productCat && productCat !== "null") queries.push(productCat);
  // key_messages 前两条
  const kmBlock = briefSummary.match(/key_messages:\n((?:\s*-\s*"?.+"?\n?){1,5})/);
  if (kmBlock) {
    const items = [...kmBlock[1]!.matchAll(/\s*-\s*"?(.+?)"?\s*$/gm)].map((m) => m[1]!).slice(0, 2);
    queries.push(...items);
  }
  return queries.filter((q) => q && q !== "null");
}
```

- [ ] **Step 4: 写 mission route `packages/web-server/src/routes/mission.ts`**

```ts
import type { FastifyInstance } from "fastify";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectStore } from "../services/project-store.js";
import type { ExpertRegistry } from "../services/expert-registry.js";
import { runMission } from "../services/mission-orchestrator.js";
import { appendEvent } from "../services/event-log.js";

export interface MissionDeps {
  store: ProjectStore;
  registry: ExpertRegistry;
  projectsDir: string;
  cli: "claude" | "codex";
  searchCtx: { sqlitePath: string; vaultPath: string };
}

export function registerMissionRoutes(app: FastifyInstance, deps: MissionDeps) {
  app.post<{ Params: { id: string }; Body: { experts: string[] } }>(
    "/api/projects/:id/mission/start",
    async (req, reply) => {
      const { id } = req.params;
      const { experts } = req.body ?? ({ experts: [] } as any);
      if (!Array.isArray(experts) || experts.length === 0) {
        return reply.code(400).send({ error: "experts required" });
      }
      // fire and forget; return 202
      setImmediate(() => {
        runMission({ projectId: id, experts, ...deps }).catch((err) => {
          app.log.error({ err, projectId: id }, "mission run failed");
        });
      });
      return reply.code(202).send({ ok: true, status: "started" });
    },
  );

  app.get<{ Params: { id: string } }>("/api/projects/:id/mission/candidates", async (req, reply) => {
    const project = await deps.store.get(req.params.id);
    if (!project?.mission?.candidates_path) return reply.code(404).send({ error: "no candidates yet" });
    const md = await readFile(join(deps.projectsDir, req.params.id, project.mission.candidates_path), "utf-8");
    reply.header("content-type", "text/markdown; charset=utf-8");
    return md;
  });

  app.post<{ Params: { id: string }; Body: { candidateIndex: number; edits?: string } }>(
    "/api/projects/:id/mission/select",
    async (req, reply) => {
      const { id } = req.params;
      const { candidateIndex, edits } = req.body;
      const project = await deps.store.get(id);
      if (!project?.mission?.candidates_path) return reply.code(400).send({ error: "no candidates" });
      const now = new Date().toISOString();
      const selectedPath = "mission/selected.md";
      const projectDir = join(deps.projectsDir, id);

      // For v1: write a minimal selected.md derived from candidatesPath + candidateIndex
      // In SP-02 we keep it simple: full candidates.md copied + selected_index marker; detailed extraction is SP-03 job.
      const candidatesMd = await readFile(join(projectDir, project.mission.candidates_path), "utf-8");
      const selectedMd = `---\ntype: mission\nproject_id: ${id}\nselected_index: ${candidateIndex}\napproved_by: human\napproved_at: ${now}\nhuman_edits: ${edits ? "true" : "false"}\n---\n\n${edits ?? ""}\n\n<!-- source candidates.md: -->\n\n${candidatesMd}\n`;
      await writeFile(join(projectDir, selectedPath), selectedMd, "utf-8");

      await deps.store.update(id, {
        status: "mission_approved",
        mission: { ...project.mission, selected_index: candidateIndex, selected_path: selectedPath, selected_at: now, selected_by: "human" },
      });
      await appendEvent(projectDir, { type: "state_changed", from: project.status, to: "mission_approved" });
      return { ok: true };
    },
  );
}
```

- [ ] **Step 5: 挂载进 server.ts**

```ts
import { registerMissionRoutes } from "./routes/mission.js";
// in buildApp:
registerMissionRoutes(app, {
  store,
  registry,
  projectsDir: cfg.projectsDir,
  cli: cfg.defaultCli,
  searchCtx: { sqlitePath: cfg.sqlitePath, vaultPath: cfg.vaultPath },
});
```

- [ ] **Step 6: Run tests + commit**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test
git add packages/web-server/src/services/mission-orchestrator.ts packages/web-server/src/routes/mission.ts packages/web-server/src/server.ts packages/web-server/tests/mission-orchestrator.test.ts
git -c commit.gpgsign=false commit -m "feat(web-server): MissionOrchestrator + /api/mission routes"
```

---

### Task 23: SSE broadcaster + /api/projects/:id/stream

**Files:**
- Create: `packages/web-server/src/services/sse-broadcaster.ts`
- Create: `packages/web-server/src/routes/stream.ts`
- Modify: `packages/web-server/src/services/event-log.ts`（appendEvent 发布到 broadcaster）
- Modify: `packages/web-server/src/server.ts`

- [ ] **Step 1: 写 `packages/web-server/src/services/sse-broadcaster.ts`**

```ts
import { EventEmitter } from "node:events";
import type { StoredEvent } from "./event-log.js";

const emitter = new EventEmitter();
emitter.setMaxListeners(100);

export function publishEvent(projectId: string, event: StoredEvent): void {
  emitter.emit(`project:${projectId}`, event);
}

export function subscribe(projectId: string, handler: (e: StoredEvent) => void): () => void {
  const key = `project:${projectId}`;
  emitter.on(key, handler);
  return () => emitter.off(key, handler);
}
```

- [ ] **Step 2: 修改 `event-log.ts` 发布事件**

在 `appendEvent` 末尾加：

```ts
import { publishEvent } from "./sse-broadcaster.js";
import { basename } from "node:path";

// ... inside appendEvent, after file write:
const projectId = basename(projectDir);
publishEvent(projectId, stored);
```

- [ ] **Step 3: 写 `packages/web-server/src/routes/stream.ts`**

```ts
import type { FastifyInstance } from "fastify";
import { readEvents } from "../services/event-log.js";
import { subscribe } from "../services/sse-broadcaster.js";
import { join } from "node:path";

export function registerStreamRoutes(app: FastifyInstance, deps: { projectsDir: string }) {
  app.get<{ Params: { id: string } }>("/api/projects/:id/stream", async (req, reply) => {
    const { id } = req.params;
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });

    // replay from events.jsonl based on Last-Event-ID
    const lastId = Number(req.headers["last-event-id"] ?? -1);
    const past = await readEvents(join(deps.projectsDir, id));
    past.forEach((e, idx) => {
      if (idx <= lastId) return;
      reply.raw.write(`id: ${idx}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    });

    let counter = past.length;
    const unsub = subscribe(id, (e) => {
      const thisId = counter++;
      reply.raw.write(`id: ${thisId}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    });

    req.raw.on("close", () => {
      unsub();
      reply.raw.end();
    });

    // keep connection open
    return reply;
  });
}
```

- [ ] **Step 4: 挂载到 server.ts**

```ts
import { registerStreamRoutes } from "./routes/stream.js";
registerStreamRoutes(app, { projectsDir: cfg.projectsDir });
```

- [ ] **Step 5: 手动 smoke**

```bash
pnpm dev
# 另开：
curl -N http://127.0.0.1:3001/api/projects/<some-id>/stream
# 触发 brief 上传等操作，应实时看到事件流
```

- [ ] **Step 6: Commit**

```bash
git add packages/web-server/src/services/sse-broadcaster.ts packages/web-server/src/services/event-log.ts packages/web-server/src/routes/stream.ts packages/web-server/src/server.ts
git -c commit.gpgsign=false commit -m "feat(web-server): SSE broadcaster + /api/projects/:id/stream with replay"
```

---

### Task 24: ExpertSelector + AgentTimeline + useProjectStream

**Files:**
- Create: `packages/web-ui/src/hooks/useProjectStream.ts`
- Create: `packages/web-ui/src/components/right/ExpertSelector.tsx`
- Create: `packages/web-ui/src/components/right/AgentTimeline.tsx`
- Modify: `packages/web-ui/src/api/client.ts`（加 mission.start）

- [ ] **Step 1: `useProjectStream.ts`**

```ts
import { useEffect, useState } from "react";

export interface StreamEvent {
  ts: string;
  type: string;
  data: Record<string, any>;
}

export function useProjectStream(projectId: string | undefined) {
  const [events, setEvents] = useState<StreamEvent[]>([]);

  useEffect(() => {
    if (!projectId) return;
    const es = new EventSource(`/api/projects/${projectId}/stream`);
    const handler = (e: MessageEvent) => {
      try { setEvents((prev) => [...prev, JSON.parse(e.data) as StreamEvent]); } catch {}
    };
    const types = [
      "state_changed", "agent.started", "agent.completed", "agent.failed",
      "expert.round1_started", "expert.round1_completed",
      "expert.round2_started", "expert.round2_completed",
      "coordinator.synthesizing", "coordinator.candidates_ready", "coordinator.aggregating",
      "refs_pack.generated",
    ];
    types.forEach((t) => es.addEventListener(t, handler));
    es.onerror = () => { /* browser auto-reconnect */ };
    return () => es.close();
  }, [projectId]);

  return events;
}
```

- [ ] **Step 2: `api/client.ts` 加 mission + experts**

追加：

```ts
export const apiMission = {
  start: (projectId: string, experts: string[]) =>
    request<{ ok: true; status: string }>(`/api/projects/${projectId}/mission/start`, {
      method: "POST",
      body: JSON.stringify({ experts }),
    }),
  getCandidates: (projectId: string) =>
    request<string>(`/api/projects/${projectId}/mission/candidates`),
  select: (projectId: string, candidateIndex: number, edits?: string) =>
    request<{ ok: true }>(`/api/projects/${projectId}/mission/select`, {
      method: "POST",
      body: JSON.stringify({ candidateIndex, edits }),
    }),
};
```

并把 `listExperts` 的返回类型改为 `{ topic_panel: Expert[] }`：

```ts
listExperts: () => request<{ topic_panel: Expert[] }>("/api/experts"),
```

- [ ] **Step 3: `components/right/ExpertSelector.tsx`**

```tsx
import { useEffect, useState } from "react";
import { api, apiMission } from "../../api/client";
import type { Expert } from "../../api/types";

export function ExpertSelector({ projectId, onStarted }: { projectId: string; onStarted: () => void }) {
  const [experts, setExperts] = useState<Expert[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.listExperts().then((res) => {
      setExperts(res.topic_panel);
      setSelected(new Set(res.topic_panel.filter((e) => e.default_preselect).map((e) => e.name)));
    });
  }, []);

  function toggle(name: string) {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setSelected(next);
  }

  async function start() {
    if (selected.size === 0) { setErr("至少选一位专家"); return; }
    setBusy(true);
    setErr(null);
    try {
      await apiMission.start(projectId, [...selected]);
      onStarted();
    } catch (e: any) { setErr(String(e.message ?? e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-3 p-4 bg-white rounded border" style={{ borderColor: "var(--border)" }}>
      <h2 className="font-semibold">选择参与评审的专家</h2>
      <div className="space-y-2">
        {experts.map((e) => (
          <label key={e.name} className="flex items-start gap-2 p-2 hover:bg-gray-50 rounded cursor-pointer">
            <input type="checkbox" checked={selected.has(e.name)} onChange={() => toggle(e.name)} />
            <div>
              <div className="font-medium">{e.name}</div>
              <div className="text-xs text-gray-600">{e.specialty}</div>
            </div>
          </label>
        ))}
      </div>
      <div className="text-sm text-gray-500">已选 {selected.size} 位</div>
      {err && <div className="text-sm text-red-600">{err}</div>}
      <button onClick={start} disabled={busy} className="px-4 py-2 rounded text-white" style={{ background: "var(--green)" }}>
        {busy ? "启动中…" : "开跑两轮评审"}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: `components/right/AgentTimeline.tsx`**

```tsx
import { useProjectStream } from "../../hooks/useProjectStream";

const LABELS: Record<string, string> = {
  "state_changed": "状态",
  "agent.started": "Agent 开始",
  "agent.completed": "Agent 完成",
  "agent.failed": "Agent 失败",
  "expert.round1_started": "专家 R1 开始",
  "expert.round1_completed": "专家 R1 完成",
  "expert.round2_started": "专家 R2 开始",
  "expert.round2_completed": "专家 R2 完成",
  "coordinator.synthesizing": "Coordinator 合成",
  "coordinator.candidates_ready": "候选就绪",
  "coordinator.aggregating": "Coordinator 聚合",
  "refs_pack.generated": "Refs pack 已建",
};

export function AgentTimeline({ projectId }: { projectId: string }) {
  const events = useProjectStream(projectId);
  return (
    <div className="p-4 bg-white rounded border" style={{ borderColor: "var(--border)" }}>
      <h3 className="font-semibold mb-2">实时进度</h3>
      <ol className="space-y-1 text-sm">
        {events.length === 0 && <li className="text-gray-400">暂无事件</li>}
        {events.map((e, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-gray-400">{new Date(e.ts).toLocaleTimeString()}</span>
            <span className="font-medium" style={{ color: "var(--green-dark)" }}>{LABELS[e.type] ?? e.type}</span>
            <span className="text-gray-600">{summarize(e.data)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function summarize(data: any): string {
  if (data.expert) return `@${data.expert}`;
  if (data.from && data.to) return `${data.from} → ${data.to}`;
  if (data.agent) return `@${data.agent}`;
  return "";
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/web-ui/src/hooks/useProjectStream.ts packages/web-ui/src/components/right/ packages/web-ui/src/api/client.ts
git -c commit.gpgsign=false commit -m "feat(web-ui): ExpertSelector + AgentTimeline + SSE hook"
```

---

### Task 25: ProjectWorkbench integration + MissionCandidateCard + SelectedMissionView

**Files:**
- Modify: `packages/web-ui/src/pages/ProjectWorkbench.tsx`
- Create: `packages/web-ui/src/components/left/BriefSummaryCard.tsx`
- Create: `packages/web-ui/src/components/left/MissionCandidateCard.tsx`
- Create: `packages/web-ui/src/components/left/SelectedMissionView.tsx`
- Create: `packages/web-ui/src/hooks/useBriefSummary.ts`
- Create: `packages/web-ui/src/hooks/useCandidates.ts`

- [ ] **Step 1: `hooks/useBriefSummary.ts`**

```ts
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

export function useBriefSummary(id: string, enabled: boolean) {
  return useQuery({
    queryKey: ["brief-summary", id],
    queryFn: () => api.getBriefSummary(id),
    enabled,
    retry: false,
  });
}
```

- [ ] **Step 2: `hooks/useCandidates.ts`**

```ts
import { useQuery } from "@tanstack/react-query";
import { apiMission } from "../api/client";

export function useCandidates(id: string, enabled: boolean) {
  return useQuery({
    queryKey: ["mission-candidates", id],
    queryFn: () => apiMission.getCandidates(id),
    enabled,
    retry: false,
  });
}
```

- [ ] **Step 3: `BriefSummaryCard.tsx`**

```tsx
import ReactMarkdown from "react-markdown";
import { useBriefSummary } from "../../hooks/useBriefSummary";

export function BriefSummaryCard({ projectId }: { projectId: string }) {
  const { data, isLoading } = useBriefSummary(projectId, true);
  if (isLoading) return <div className="text-gray-500">加载摘要…</div>;
  if (!data) return <div className="text-gray-500">摘要未生成</div>;
  return (
    <article className="prose max-w-none bg-white p-6 rounded border" style={{ borderColor: "var(--border)" }}>
      <ReactMarkdown>{data}</ReactMarkdown>
    </article>
  );
}
```

- [ ] **Step 4: `MissionCandidateCard.tsx`**

```tsx
import ReactMarkdown from "react-markdown";
import { useCandidates } from "../../hooks/useCandidates";
import { apiMission } from "../../api/client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

export function MissionCandidatesPanel({ projectId, onSelected }: { projectId: string; onSelected: () => void }) {
  const { data } = useCandidates(projectId, true);
  const [busyIdx, setBusyIdx] = useState<number | null>(null);
  const qc = useQueryClient();

  async function pick(idx: number) {
    setBusyIdx(idx);
    try {
      await apiMission.select(projectId, idx);
      qc.invalidateQueries({ queryKey: ["projects", projectId] });
      onSelected();
    } finally {
      setBusyIdx(null);
    }
  }

  if (!data) return <div className="text-gray-500">候选加载中…</div>;

  // 非常粗地按 "# 候选 " 分段（v1 简化；SP-03 可换专业 yaml/md parser）
  const parts = data.split(/^# 候选 /m).slice(1);
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">3 个候选 Mission</h2>
      {parts.map((body, i) => (
        <div key={i} className="p-4 bg-white rounded border" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-medium">候选 {body.split("\n")[0]}</h3>
            <button
              onClick={() => pick(i + 1)}
              disabled={busyIdx !== null}
              className="px-3 py-1 rounded text-white text-sm"
              style={{ background: "var(--green)" }}
            >
              {busyIdx === i + 1 ? "保存中…" : "采用这个"}
            </button>
          </div>
          <div className="prose max-w-none prose-sm">
            <ReactMarkdown>{`# 候选 ${body}`}</ReactMarkdown>
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: `SelectedMissionView.tsx`**

```tsx
import ReactMarkdown from "react-markdown";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";

export function SelectedMissionView({ projectId, selectedPath }: { projectId: string; selectedPath: string }) {
  // v1: 直接展示 candidates.md（因为 selected.md 包含它），SP-03 再做精细化
  const { data } = useQuery({
    queryKey: ["selected-mission", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/mission/candidates`);
      return res.text();
    },
  });
  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">Mission 已选定 ✅</h2>
      {data ? (
        <article className="prose max-w-none bg-[var(--green-light)] p-6 rounded border" style={{ borderColor: "var(--green-border)" }}>
          <ReactMarkdown>{data}</ReactMarkdown>
        </article>
      ) : null}
      <p className="text-sm text-gray-500 mt-2">selected path: {selectedPath}</p>
    </div>
  );
}
```

- [ ] **Step 6: 最终 `ProjectWorkbench.tsx`**

```tsx
import { useParams } from "react-router-dom";
import { useProject } from "../hooks/useProjects";
import { BriefIntakeForm } from "../components/right/BriefIntakeForm";
import { ExpertSelector } from "../components/right/ExpertSelector";
import { AgentTimeline } from "../components/right/AgentTimeline";
import { BriefSummaryCard } from "../components/left/BriefSummaryCard";
import { MissionCandidatesPanel } from "../components/left/MissionCandidateCard";
import { SelectedMissionView } from "../components/left/SelectedMissionView";

export function ProjectWorkbench() {
  const { id } = useParams<{ id: string }>();
  const { data: project, refetch } = useProject(id);
  if (!project || !id) return <div className="p-6">加载中…</div>;

  const status = project.status;
  const showExpertSelector = status === "brief_ready" || status === "awaiting_expert_selection";
  const showCandidates = status === "awaiting_mission_pick" || status === "mission_approved";
  const showSelected = status === "mission_approved";

  return (
    <div className="h-screen flex flex-col">
      <header className="p-4 border-b bg-white flex items-center gap-3" style={{ borderColor: "var(--border)" }}>
        <a href="/" className="text-sm text-gray-500">← 列表</a>
        <h1 className="font-semibold">{project.name}</h1>
        <span className="text-xs px-2 py-0.5 rounded bg-gray-100">{project.status}</span>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <div className="w-3/5 border-r overflow-auto p-6 space-y-6" style={{ borderColor: "var(--border)" }}>
          {status === "created" ? (
            <div className="text-gray-500">右侧上传 Brief 开始</div>
          ) : (
            <BriefSummaryCard projectId={id} />
          )}
          {showCandidates && !showSelected && (
            <MissionCandidatesPanel projectId={id} onSelected={() => refetch()} />
          )}
          {showSelected && project.mission.selected_path && (
            <SelectedMissionView projectId={id} selectedPath={project.mission.selected_path} />
          )}
        </div>

        <div className="w-2/5 overflow-auto p-6 bg-[var(--gray-light)] space-y-4">
          {status === "created" && (
            <BriefIntakeForm projectId={id} onUploaded={() => refetch()} />
          )}
          {(status === "brief_uploaded" || status === "brief_analyzing") && (
            <div className="p-4 bg-white rounded border">Brief Analyst 运行中…</div>
          )}
          {showExpertSelector && (
            <ExpertSelector projectId={id} onStarted={() => refetch()} />
          )}
          <AgentTimeline projectId={id} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: 启动 + Commit**

```bash
pnpm dev
# 端到端手动过一遍：新建 → 上传 brief → 摘要显示 → 选专家 → 跑两轮 → 选候选 → 显示 Mission
git add packages/web-ui/
git -c commit.gpgsign=false commit -m "feat(web-ui): integrate Workbench with all left/right components"
```

---

### Task 26: 端到端 smoke（真机 codex + MetaNovas sample brief）

**Files:**
- Create: `docs/superpowers/notes/2026-04-XX-sp02-acceptance.md`
- Create: `samples/briefs/metanovas-sample.md`（占位 Brief）

- [ ] **Step 1: 造一份示例 Brief**

```bash
mkdir -p /Users/zeoooo/crossing-writer/samples/briefs
cat > /Users/zeoooo/crossing-writer/samples/briefs/metanovas-sample.md <<'EOF'
# MetaNovas MetaClaw Brief (示例)

## 客户
- 公司：MetaNovas（AI 多 Agent 平台创业公司）
- 品牌：MetaNovas
- 产品：MetaClaw — 多 Agent 工作流编排平台

## 目标
面向 AI 内容创作者和技术团队，传播 MetaClaw 的 Workflow DSL 是把多 Agent 系统从"玩具"变"工具"的关键。

## 核心信息
- 多 Agent 协作是品牌内容生产的解药
- Workflow DSL 可以让非技术同学编排 Agent
- 原生中文理解 + 社区模板生态

## 禁区
- 不要说"替代人类写手"
- 不要贬低具体友商（比如 LangGraph、AutoGen）

## 语气
克制专业，避免炸裂/颠覆等词。偏十字路口的深度实测调性。

## 交付
一篇 3000-5000 字的公众号文章，配截图，截稿日 2026-05-15（soft）。
EOF
```

- [ ] **Step 2: 确保 codex CLI 可用**

```bash
which codex && codex exec "say hi in 2 words" 2>&1 | tail -3
```

- [ ] **Step 3: 启动 server + UI**

```bash
cd /Users/zeoooo/crossing-writer && pnpm dev
```

- [ ] **Step 4: 浏览器跑完整流程**

1. 打开 `localhost:3000`
2. 新建项目 "MetaNovas 实测 (SP-02 smoke)"
3. 右侧粘贴 `samples/briefs/metanovas-sample.md` 的内容
4. 产品名：MetaClaw / 官网：空 / 备注：空
5. 点"开始解析 Brief"
6. 等左侧出现 brief-summary（通常 1-2 分钟）
7. 右侧弹出 ExpertSelector，默认勾选赛博禅心 + 卡兹克
8. 点"开跑两轮评审"
9. 右侧时间线依次出现：refs_pack → expert.round1 × 2 → synthesizing → candidates_ready → expert.round2 × 2 → awaiting_mission_pick
10. 左侧出现 3 个候选 Mission
11. 点任一候选"采用这个"
12. 左侧进入 SelectedMissionView，右上角状态变 `mission_approved`

预估总耗时：8-12 分钟（每位专家 codex exec 一轮 ≈ 2-3 分钟 × 2 轮 × 2 位 + 合成/聚合 2 轮 ≈ 10 轮子进程）

- [ ] **Step 5: 写 acceptance 报告**

```bash
cat > /Users/zeoooo/crossing-writer/docs/superpowers/notes/2026-04-XX-sp02-acceptance.md <<'EOF'
# SP-02 Acceptance (MetaNovas smoke)

Date: <YYYY-MM-DD>
Duration: <N> min total (brief analyzing <X>m, round1 <Y>m, synth <Z>m, round2 <W>m)
LLM calls:
- Brief Analyst × 1
- TopicExpert round1 × 2
- Coordinator round1 × 1
- TopicExpert round2 × 2
- Coordinator round2 × 1

Artifacts produced in ~/CrossingVault/07_projects/<slug>/:
- brief/raw/brief.txt
- brief/brief.md
- brief/brief-summary.md
- context/refs-pack.md
- mission/round1/赛博禅心.md
- mission/round1/数字生命卡兹克.md
- mission/candidates.md
- mission/round2/*.md
- mission/selected.md
- events.jsonl

Manual review:
- [ ] brief-summary 字段齐全且正确
- [ ] 3 个候选 Mission 角度有区分度
- [ ] round2 评分聚合排序正确
- [ ] selected.md 可读，SP-03 可作为输入

Issues:
- 

Verdict:
- 
EOF
```

- [ ] **Step 6: Commit**

```bash
git add samples/briefs/metanovas-sample.md docs/superpowers/notes/2026-04-XX-sp02-acceptance.md
git -c commit.gpgsign=false commit -m "docs: SP-02 acceptance smoke run template + sample brief"
```

---

## Self-Review

**Spec coverage** — 每一节：

| Spec 章节 | 对应 Task |
|---|---|
| §1 背景 + §2 非目标 | 文档性，无 task |
| §3 用户故事 | §3.1 主流程 → Task 16/24/25 集成；§3.2 副故事 → Task 15 项目列表 |
| §4 技术栈 + §5 物理布局 | Task 1 |
| §6.2 project.json | Task 6 |
| §6.3 brief-summary.md | Task 11 prompt |
| §6.4 candidates.md | Task 21 coordinator-round1 prompt |
| §6.5 selected.md | Task 22 select route（v1 简化，SP-03 细化） |
| §6.6 index.yaml | Task 17 |
| §7 专家团架构 | Task 17 + Task 18 registry |
| §8 两轮评审流程 | Task 22 orchestrator |
| §9 refs 检索 | Task 19 + Task 4 tool-runner |
| §10 per-agent 模型配置 | Task 2 config.ts + resolveAgent |
| §11 UI 设计 | Task 13/15/16/24/25 |
| §12 状态机 | Task 6 state-machine.ts |
| §13 SSE 事件流 | Task 23 |
| §14 API 设计 | Task 7/10/12/18/22/23 |
| §15 验收标准 | Task 26 acceptance |
| §16 风险 | 运行时处理，plan 不单独做 task |

**Placeholder scan**：扫描"TBD/TODO/后续/fill in"——
- Task 22 `selected.md` 是"v1 简化" — 明确指向 SP-03，不算 TBD
- Task 25 "非常粗地按 # 候选 分段" — 明确 fallback，SP-03 re-做
- Task 16 `useBriefSummary` 用 `require` — 备注说是权宜，Task 25 已提取为独立 hook 解决了
无阻塞性 TBD。

**Type consistency**：
- `Project` 接口在 Task 6 (store) 和 Task 14 (UI types) 都有定义 — 字段一致
- `SearchCtx` 来自 SP-01 `@crossing/kb`，Task 19/22 都用同一 import
- `AgentResult` 在 Task 2 定义，Task 3/11/20/21 都用 `.text` 和 `.meta` — 一致
- 状态机 enum 在 Task 6 (`ProjectStatus`) 和 Task 14 (`ProjectStatus` UI 版) 都列出来 — 字符串字面值一致

---

## Handoff

Plan 完整写入 `docs/superpowers/plans/2026-04-13-sp02-mission-workbench.md`（26 个 task）。

实施方式二选一：

1. **Subagent-Driven（推荐）**：我每 task 派一个 fresh subagent，两阶段 review，通过后进下一个
2. **Inline Execution**：本会话批量跑，关键 checkpoint 停下给你看

选哪个？

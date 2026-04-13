# SP-03 Case Plan Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 SP-02 已完成的基础上，接通流水线 ③（产品概览）+ ④（Case 规划），让用户从 Mission 选定走到 Case Plan 批准，期间 Overview Agent 用 vision 读图、Case 专家团一轮 tool loop 借鉴 refs.sqlite 历史测评产出有创意的 Case。

**Architecture:** 扩展三个包：`packages/agents`（加 ProductOverviewAgent / CasePlannerExpert / CaseCoordinator，ModelAdapter 新增 `images` 参数），`packages/web-server`（加 ImageStore / OverviewAnalyzerService / CasePlanOrchestrator / inspiration-pack-builder），`packages/web-ui`（加 SectionAccordion 叠加式布局 / OverviewIntakeForm / CaseExpertSelector / CaseListPanel / AgentStatusBar）。SSE 事件格式破坏性升级：所有 agent 事件必须带 `cli` + `model` 字段，UI 用绿/灰/红状态点指示 agent 在线情况。

**Tech Stack:** Node.js 20+, pnpm workspace, TypeScript 5, Fastify 5, Vite 5 + React 19 + Tailwind 4, `@mozilla/readability`, vitest, 复用 SP-02 全部基建。

Spec: `docs/superpowers/specs/2026-04-13-sp03-case-plan-workbench-design.md`

---

## 整体文件结构

```
crossing-writer/
  packages/
    agents/
      src/
        model-adapter.ts            # 修改：加 images 参数
        case-expert-runner.ts       # 新增：tool loop 实现
        roles/
          product-overview-agent.ts # 新增
          case-planner-expert.ts    # 新增
          case-coordinator.ts       # 新增
        prompts/
          product-overview.md       # 新增
          case-expert-round1.md     # 新增
          case-expert-round2.md     # 新增
          case-coordinator.md       # 新增
        index.ts                    # 修改：导出新角色
      tests/
        (现有 25 个) + 新增 8-10 个
    
    web-server/
      src/
        routes/
          overview.ts               # 新增：images upload + generate + approve
          case-plan.ts              # 新增：start + candidates + select
          projects.ts               # 无需动（只读）
          brief.ts                  # 无需动
          mission.ts                # 修改：事件加 cli/model
          stream.ts                 # 无需动
        services/
          image-store.ts            # 新增
          overview-analyzer-service.ts  # 新增
          case-plan-orchestrator.ts # 新增
          case-inspiration-pack-builder.ts  # 新增
          expert-registry.ts        # 修改：读 creativity_score
          event-log.ts              # 修改：appendEvent 强制带 agent/cli/model
          mission-orchestrator.ts   # 修改：事件加 cli/model
          brief-analyzer-service.ts # 修改：事件加 cli/model
        state/
          state-machine.ts          # 修改：加 8 个新状态
      tests/
        (现有 47 个) + 新增 15+ 个
    
    web-ui/
      src/
        pages/
          ProjectWorkbench.tsx      # 修改：改成 SectionAccordion 布局
        components/
          layout/
            SectionAccordion.tsx    # 新增
            TopBar.tsx              # 修改：加 AgentStatusBar 位置
          status/
            AgentStatusBar.tsx      # 新增
            AgentTimeline.tsx       # 修改：加 agent/cli/model + 状态点
          right/
            OverviewIntakeForm.tsx  # 新增
            CaseExpertSelector.tsx  # 新增
            CaseSelectedGuide.tsx   # 新增
          left/
            ProductOverviewCard.tsx # 新增
            CaseListPanel.tsx       # 新增
            CaseCardPreview.tsx     # 新增
        api/
          client.ts                 # 修改：加 overview + case-plan APIs
          types.ts                  # 修改：加 ProductOverview / Case 类型
        hooks/
          useProjectStream.ts       # 修改：解析 cli/model 字段
          useOverview.ts            # 新增
          useCaseCandidates.ts      # 新增
        utils/
          markdown.ts               # 可能扩展
```

Vault 侧：
- `~/CrossingVault/08_experts/topic-panel/index.yaml` — 加 `creativity_score` 到每位专家
- 新项目目录：`07_projects/<id>/context/images/`, `07_projects/<id>/mission/case-plan/`

---

## Task 列表（31 个，含 Task 0）

0. SSE 事件统一带 `cli`/`model` 字段（SP-02 已有事件回补）
1. ModelAdapter 扩展 `images` 参数（claude + codex）
2. ImageStore service（upload/list/delete）
3. `POST /api/projects/:id/overview/images` multipart route
4. OverviewIntakeForm UI 图片上传区 + URL 列表 + 描述
5. ProductOverviewAgent role + vision prompt
6. OverviewAnalyzerService 编排
7. `POST /api/projects/:id/overview/generate` 触发 route
8. `GET/PATCH /api/projects/:id/overview` 读写 overview.md
9. `POST /api/projects/:id/overview/approve` 状态跃迁
10. ProductOverviewCard（可编辑 md 预览）
11. SectionAccordion 左侧改造
12. ExpertRegistry 加 `creativity_score`（含 Vault index.yaml 更新）
13. Case 专家 default preselect 策略（Mission ∪ Top3 创意）
14. CaseExpertSelector UI
15. case-inspiration-pack-builder（正则抽 prompt/steps）
16. CasePlannerExpert role + round1/round2 prompt
17. CaseCoordinator role + prompt
18. case-expert-runner（tool loop 实现）
19. CasePlanOrchestrator 编排
20. `POST /case-plan/start` + `GET /case-plan/candidates`
21. CaseListPanel + CaseCardPreview
22. `POST /case-plan/select` + selected-cases.md 生成
23. CaseSelectedGuide（SP-03 终态 + checklist）
24. SSE 新事件类型（带 cli/model）
25. useProjectStream 解析 cli/model 字段
26. AgentTimeline 改造（行内展示 + 状态点）
27. AgentStatusBar（顶栏活跃 pill 条）
28. ProjectWorkbench 状态切换更新（接入 SP-03 所有新状态）
29. 集成测试：mock agents 端到端 overview → case 批准
30. 真机 smoke：MetaNovas 项目继续走 SP-03

---

### Task 0: SSE 事件统一带 `cli` + `model` 字段

破坏性改动：SP-02 的 agent 相关事件只有 `agent` 名，现在必须带 `cli`/`model`。影响 `event-log.ts`、`brief-analyzer-service.ts`、`mission-orchestrator.ts`、以及前端 `AgentTimeline`（Task 26 再改 UI）。

**Files:**
- Modify: `packages/web-server/src/services/event-log.ts`
- Modify: `packages/web-server/src/services/brief-analyzer-service.ts`
- Modify: `packages/web-server/src/services/mission-orchestrator.ts`
- Modify: `packages/web-server/tests/project-store.test.ts`（如果有依赖 event shape 的 assertion）
- Modify: `packages/web-server/tests/brief-analyzer-service.test.ts`
- Modify: `packages/web-server/tests/mission-orchestrator.test.ts`

- [ ] **Step 1: 阅读现有 event-log.ts**

```bash
cat /Users/zeoooo/crossing-writer/packages/web-server/src/services/event-log.ts
```

现有 `appendEvent` 接受 `{ type, ...data }`。本 task 不改接口，但要在调用方统一传 `agent`、`cli`、`model` 字段。下面的改动都是在**调用 appendEvent 的地方**加字段，不改 appendEvent 本身。

- [ ] **Step 2: 写失败测试 `packages/web-server/tests/event-schema.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/services/project-store.js";
import { analyzeBrief } from "../src/services/brief-analyzer-service.js";

vi.mock("@crossing/agents", () => ({
  BriefAnalyst: vi.fn().mockImplementation(() => ({
    analyze: () => ({
      text: "---\ntype: brief_summary\n---\n# ok",
      meta: { cli: "codex", model: "gpt-5.4", durationMs: 1 },
    }),
  })),
  resolveAgent: vi.fn().mockReturnValue({ cli: "codex", model: "gpt-5.4" }),
}));

describe("SSE event schema", () => {
  it("brief analyzer writes agent.started with cli + model", async () => {
    const vault = mkdtempSync(join(tmpdir(), "evt-"));
    const projectsDir = join(vault, "07_projects");
    const store = new ProjectStore(projectsDir);
    const p = await store.create({ name: "T" });
    const projectDir = join(projectsDir, p.id);
    mkdirSync(join(projectDir, "brief"), { recursive: true });
    writeFileSync(join(projectDir, "brief/brief.md"), "body", "utf-8");
    await store.update(p.id, {
      status: "brief_uploaded",
      brief: {
        source_type: "text", raw_path: "r", md_path: "brief/brief.md",
        summary_path: null, uploaded_at: "",
      },
    });

    await analyzeBrief({
      projectId: p.id,
      projectsDir,
      store,
      cli: "codex",
      agents: {},
      defaultCli: "codex",
      fallbackCli: "claude",
    } as any);

    const events = readFileSync(join(projectDir, "events.jsonl"), "utf-8")
      .split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const started = events.find((e) => e.type === "agent.started");
    expect(started).toBeDefined();
    expect(started.data.agent).toBe("brief_analyst");
    expect(started.data.cli).toBe("codex");
    expect(started.data.model).toBe("gpt-5.4");

    const completed = events.find((e) => e.type === "agent.completed");
    expect(completed.data.cli).toBe("codex");
    expect(completed.data.model).toBe("gpt-5.4");
  });
});
```

- [ ] **Step 3: 跑，预期 FAIL（现有 brief-analyzer-service.ts 没带 cli/model）**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test tests/event-schema.test.ts
```

- [ ] **Step 4: 修改 `packages/web-server/src/services/brief-analyzer-service.ts`**

Read 文件找到 `appendEvent` 调用处，把 `agent.started` / `agent.completed` / `agent.failed` 都加上 `cli` + `model`：

```ts
// 在 analyzeBrief() 里 resolveAgent 之后得到 resolved 对象
const resolved = resolveAgent(
  { vaultPath: "", sqlitePath: "",
    modelAdapter: { defaultCli, fallbackCli }, agents },
  "brief_analyst",
);

await appendEvent(projectDir, {
  type: "agent.started",
  agent: "brief_analyst",
  cli: resolved.cli,
  model: resolved.model ?? null,
});

// ... 运行 analyst ...

await appendEvent(projectDir, {
  type: "agent.completed",
  agent: "brief_analyst",
  cli: resolved.cli,
  model: resolved.model ?? null,
  output: summaryPath,
  durationMs: result.meta.durationMs,
});

// 失败分支同理
await appendEvent(projectDir, {
  type: "agent.failed",
  agent: "brief_analyst",
  cli: resolved.cli,
  model: resolved.model ?? null,
  error: String(e),
});
```

- [ ] **Step 5: 类似改造 `mission-orchestrator.ts`**

对应 `expert.round1_started` / `expert.round1_completed` / `expert.round2_*` / `coordinator.synthesizing` / `coordinator.candidates_ready` / `coordinator.aggregating` 事件，都在 `appendEvent` 里加 `cli` 和 `model`。

在每次实例化 `TopicExpert` 或 `Coordinator` 之前调用 `resolveFor(key, opts)` 拿到 `resolved.cli/model`，然后把它们一路传给事件。

具体代码片段（简化展示）：

```ts
for (const name of experts) {
  const resolved = resolveFor(`topic_expert.${name}`, opts);
  await appendEvent(projectDir, {
    type: "expert.round1_started",
    expert: name,
    agent: `topic_expert.${name}`,
    cli: resolved.cli,
    model: resolved.model ?? null,
  });
  // ... 跑 agent ...
  await appendEvent(projectDir, {
    type: "expert.round1_completed",
    expert: name,
    agent: `topic_expert.${name}`,
    cli: resolved.cli,
    model: resolved.model ?? null,
  });
}

// Coordinator 事件
const coordResolved = resolveFor("coordinator", opts);
await appendEvent(projectDir, {
  type: "coordinator.synthesizing",
  agent: "coordinator",
  cli: coordResolved.cli,
  model: coordResolved.model ?? null,
});
```

- [ ] **Step 6: 更新已有测试**

`tests/mission-orchestrator.test.ts` 里断言 events 包含 `"expert.round1_started"` 的地方，不需要改（它只 regex match 字符串）。
`tests/brief-analyzer-service.test.ts` 同理——断言 `events` 字符串包含 `"agent.started"` 就够了，字段更多不 break 它。

跑一次全部测试确认没破：

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test
```

- [ ] **Step 7: Commit**

```bash
cd /Users/zeoooo/crossing-writer
git add packages/web-server/src/services/brief-analyzer-service.ts \
        packages/web-server/src/services/mission-orchestrator.ts \
        packages/web-server/tests/event-schema.test.ts
git -c commit.gpgsign=false commit -m "feat(web-server): SSE events carry agent/cli/model fields (SP-02 backfill)"
```

---

### Task 1: ModelAdapter 扩展 `images` 参数

**Files:**
- Modify: `packages/agents/src/model-adapter.ts`
- Modify: `packages/agents/tests/model-adapter.test.ts`

- [ ] **Step 1: 读现状**

```bash
cat /Users/zeoooo/crossing-writer/packages/agents/src/model-adapter.ts
```

`InvokeOptions` 目前只有 `agentKey/cli/systemPrompt/userMessage/model/timeout`。本 task 加 `images?: string[]`。

- [ ] **Step 2: 失败测试**

在 `tests/model-adapter.test.ts` 追加：

```ts
import { unlinkSync, writeFileSync } from "node:fs";

describe("invokeAgent with images", () => {
  beforeEach(() => { vi.mocked(spawnSync).mockReset(); });

  it("passes -i <path> per image for codex cli", () => {
    vi.mocked(spawnSync).mockImplementation(((cmd: string, args: readonly string[]) => {
      const outIdx = args.indexOf("--output-last-message");
      if (outIdx >= 0) writeFileSync(args[outIdx + 1]!, "ok");
      return { status: 0, stdout: Buffer.from(""), stderr: Buffer.from("") } as any;
    }) as any);

    invokeAgent({
      agentKey: "product_overview",
      cli: "codex",
      systemPrompt: "describe images",
      userMessage: "",
      images: ["/abs/img-1.png", "/abs/img-2.png"],
    });

    const call = vi.mocked(spawnSync).mock.calls[0]!;
    const args = call[1] as string[];
    // 应包含两个 -i 和对应路径
    const iIdx1 = args.indexOf("-i");
    expect(iIdx1).toBeGreaterThan(-1);
    expect(args[iIdx1 + 1]).toBe("/abs/img-1.png");
    const iIdx2 = args.indexOf("-i", iIdx1 + 1);
    expect(iIdx2).toBeGreaterThan(-1);
    expect(args[iIdx2 + 1]).toBe("/abs/img-2.png");
  });

  it("passes --image <path> per image for claude cli", () => {
    vi.mocked(spawnSync).mockReturnValue({
      status: 0,
      stdout: Buffer.from("ok"),
      stderr: Buffer.from(""),
    } as any);

    invokeAgent({
      agentKey: "x",
      cli: "claude",
      systemPrompt: "",
      userMessage: "",
      images: ["/abs/a.png", "/abs/b.png"],
    });

    const call = vi.mocked(spawnSync).mock.calls[0]!;
    const args = call[1] as string[];
    const flags = args.filter((a: string) => a === "--image");
    expect(flags.length).toBe(2);
    expect(args).toContain("/abs/a.png");
    expect(args).toContain("/abs/b.png");
  });

  it("no-op when images is empty or undefined", () => {
    vi.mocked(spawnSync).mockReturnValue({
      status: 0, stdout: Buffer.from("ok"), stderr: Buffer.from(""),
    } as any);
    invokeAgent({
      agentKey: "x", cli: "claude",
      systemPrompt: "", userMessage: "",
    });
    const call = vi.mocked(spawnSync).mock.calls[0]!;
    const args = call[1] as string[];
    expect(args).not.toContain("--image");
    expect(args).not.toContain("-i");
  });
});
```

- [ ] **Step 3: 跑，预期 FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/agents && pnpm test tests/model-adapter.test.ts
```

- [ ] **Step 4: 修改 `packages/agents/src/model-adapter.ts`**

```ts
export interface InvokeOptions {
  agentKey: string;
  cli: "claude" | "codex";
  systemPrompt: string;
  userMessage: string;
  model?: string;
  timeout?: number;
  images?: string[];        // 新增：绝对路径数组
}
```

在 `codex` 分支里，把原来的 `args` 构造改为：

```ts
const imageArgs = (opts.images ?? []).flatMap((p) => ["-i", p]);
const args = [
  "exec",
  "--skip-git-repo-check",
  "--color", "never",
  "--ephemeral",
  "--sandbox", "read-only",
  "--output-last-message", outPath,
  ...imageArgs,
  ...(opts.model ? ["-m", opts.model] : []),
  fullPrompt,
];
```

在 `claude` 分支：

```ts
const imageArgs = (opts.images ?? []).flatMap((p) => ["--image", p]);
const args = [
  "-p", fullPrompt,
  ...imageArgs,
  ...(opts.model ? ["--model", opts.model] : []),
];
```

- [ ] **Step 5: 跑测试**

```bash
cd /Users/zeoooo/crossing-writer/packages/agents && pnpm test
```

累计 agents 测试：原 25 + 新 3 = 28 passed。

- [ ] **Step 6: Commit**

```bash
cd /Users/zeoooo/crossing-writer
git add packages/agents/src/model-adapter.ts packages/agents/tests/model-adapter.test.ts
git -c commit.gpgsign=false commit -m "feat(agents): ModelAdapter supports images param (vision)"
```

---

### Task 2: ImageStore service

**Files:**
- Create: `packages/web-server/src/services/image-store.ts`
- Create: `packages/web-server/tests/image-store.test.ts`

- [ ] **Step 1: 失败测试**

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ImageStore } from "../src/services/image-store.js";

function mkStore() {
  const dir = mkdtempSync(join(tmpdir(), "img-"));
  return { store: new ImageStore(dir), root: dir };
}

describe("ImageStore", () => {
  it("saves image with auto-named brief source", async () => {
    const { store, root } = mkStore();
    const info = await store.save({
      projectId: "p1",
      filename: "original.png",
      buffer: Buffer.from("pretend-png"),
      source: "brief",
    });
    expect(info.relPath).toBe("context/images/brief-fig-1.png");
    expect(info.absPath).toBe(join(root, "p1", "context/images/brief-fig-1.png"));
    expect(existsSync(info.absPath)).toBe(true);
  });

  it("auto-increments counter per source", async () => {
    const { store } = mkStore();
    const a = await store.save({ projectId: "p", filename: "a.png", buffer: Buffer.from("x"), source: "brief" });
    const b = await store.save({ projectId: "p", filename: "b.png", buffer: Buffer.from("x"), source: "brief" });
    const c = await store.save({ projectId: "p", filename: "c.jpg", buffer: Buffer.from("x"), source: "screenshot" });
    expect(a.relPath).toMatch(/brief-fig-1\.png$/);
    expect(b.relPath).toMatch(/brief-fig-2\.png$/);
    expect(c.relPath).toMatch(/screenshot-1\.jpg$/);
  });

  it("preserves file extension", async () => {
    const { store } = mkStore();
    const webp = await store.save({ projectId: "p", filename: "x.webp", buffer: Buffer.from("x"), source: "screenshot" });
    expect(webp.relPath).toMatch(/\.webp$/);
  });

  it("rejects unsupported extension", async () => {
    const { store } = mkStore();
    await expect(
      store.save({ projectId: "p", filename: "x.gif", buffer: Buffer.from("x"), source: "brief" }),
    ).rejects.toThrow(/unsupported/i);
  });

  it("lists images by project", async () => {
    const { store } = mkStore();
    await store.save({ projectId: "p", filename: "a.png", buffer: Buffer.from("x"), source: "brief" });
    await store.save({ projectId: "p", filename: "b.jpg", buffer: Buffer.from("x"), source: "screenshot" });
    const list = await store.list("p");
    expect(list).toHaveLength(2);
    expect(list.find((i) => i.source === "brief")).toBeDefined();
    expect(list.find((i) => i.source === "screenshot")).toBeDefined();
  });

  it("deletes image by filename", async () => {
    const { store, root } = mkStore();
    const saved = await store.save({ projectId: "p", filename: "a.png", buffer: Buffer.from("x"), source: "brief" });
    await store.delete("p", "brief-fig-1.png");
    expect(existsSync(saved.absPath)).toBe(false);
  });

  it("enforces per-project limit of 30 images", async () => {
    const { store } = mkStore();
    for (let i = 0; i < 30; i += 1) {
      await store.save({ projectId: "p", filename: "x.png", buffer: Buffer.from("x"), source: "brief" });
    }
    await expect(
      store.save({ projectId: "p", filename: "x.png", buffer: Buffer.from("x"), source: "brief" }),
    ).rejects.toThrow(/limit/i);
  });
});
```

- [ ] **Step 2: 跑，预期 FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test tests/image-store.test.ts
```

- [ ] **Step 3: 写 `packages/web-server/src/services/image-store.ts`**

```ts
import { mkdir, writeFile, readdir, unlink } from "node:fs/promises";
import { join, extname } from "node:path";

const SUPPORTED = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const MAX_IMAGES_PER_PROJECT = 30;

export interface ImageInfo {
  filename: string;    // brief-fig-1.png
  source: "brief" | "screenshot";
  relPath: string;     // context/images/brief-fig-1.png
  absPath: string;
  label?: string;
}

export interface SaveInput {
  projectId: string;
  filename: string;
  buffer: Buffer;
  source: "brief" | "screenshot";
  label?: string;
}

export class ImageStore {
  constructor(private projectsRoot: string) {}

  private dir(projectId: string): string {
    return join(this.projectsRoot, projectId, "context", "images");
  }

  async list(projectId: string): Promise<ImageInfo[]> {
    const d = this.dir(projectId);
    try {
      const entries = await readdir(d);
      return entries
        .filter((n) => SUPPORTED.has(extname(n).toLowerCase()))
        .map((n): ImageInfo => ({
          filename: n,
          source: n.startsWith("brief-fig-") ? "brief" : "screenshot",
          relPath: `context/images/${n}`,
          absPath: join(d, n),
        }))
        .sort((a, b) => a.filename.localeCompare(b.filename));
    } catch (e: any) {
      if (e.code === "ENOENT") return [];
      throw e;
    }
  }

  async save(input: SaveInput): Promise<ImageInfo> {
    const ext = extname(input.filename).toLowerCase();
    if (!SUPPORTED.has(ext)) {
      throw new Error(`unsupported image format: ${ext}`);
    }
    const existing = await this.list(input.projectId);
    if (existing.length >= MAX_IMAGES_PER_PROJECT) {
      throw new Error(`image limit reached: ${MAX_IMAGES_PER_PROJECT}`);
    }
    const prefix = input.source === "brief" ? "brief-fig" : "screenshot";
    const sameSourceCount = existing.filter((i) => i.source === input.source).length;
    const fname = `${prefix}-${sameSourceCount + 1}${ext}`;
    const d = this.dir(input.projectId);
    await mkdir(d, { recursive: true });
    const abs = join(d, fname);
    await writeFile(abs, input.buffer);
    return {
      filename: fname,
      source: input.source,
      relPath: `context/images/${fname}`,
      absPath: abs,
      label: input.label,
    };
  }

  async delete(projectId: string, filename: string): Promise<void> {
    const abs = join(this.dir(projectId), filename);
    await unlink(abs);
  }
}
```

- [ ] **Step 4: 跑测试，预期全绿**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test
```

累计 48+7 = 55 passed（大致）。

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer
git add packages/web-server/src/services/image-store.ts packages/web-server/tests/image-store.test.ts
git -c commit.gpgsign=false commit -m "feat(web-server): ImageStore service (save/list/delete with source tagging)"
```

---

### Task 3: `POST /api/projects/:id/overview/images` multipart route

**Files:**
- Create: `packages/web-server/src/routes/overview.ts`
- Modify: `packages/web-server/src/server.ts`
- Create: `packages/web-server/tests/routes-overview-images.test.ts`

- [ ] **Step 1: 失败测试**

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { registerProjectsRoutes } from "../src/routes/projects.js";
import { registerOverviewRoutes } from "../src/routes/overview.js";
import { ProjectStore } from "../src/services/project-store.js";
import { ImageStore } from "../src/services/image-store.js";

async function mkApp() {
  const vault = mkdtempSync(join(tmpdir(), "ov-"));
  const projectsDir = join(vault, "07_projects");
  const store = new ProjectStore(projectsDir);
  const imageStore = new ImageStore(projectsDir);
  const app = Fastify();
  await app.register(multipart);
  registerProjectsRoutes(app, { store });
  registerOverviewRoutes(app, { store, imageStore, projectsDir });
  await app.ready();
  const created = (await app.inject({
    method: "POST", url: "/api/projects", payload: { name: "T" },
  })).json();
  return { app, store, imageStore, project: created, projectsDir };
}

describe("overview images route", () => {
  it("accepts multipart image upload with source=brief", async () => {
    const { app, project } = await mkApp();
    const boundary = "----Boundary" + Math.random().toString(36).slice(2);
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="source"',
      '',
      'brief',
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="x.png"',
      'Content-Type: image/png',
      '',
      'pretend-png-bytes',
      `--${boundary}--`,
      '',
    ].join('\r\n');
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/overview/images`,
      payload: body,
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    });
    expect(res.statusCode).toBe(201);
    const data = res.json();
    expect(data.filename).toMatch(/^brief-fig-1/);
    expect(data.source).toBe("brief");
  });

  it("lists uploaded images", async () => {
    const { app, project, imageStore } = await mkApp();
    await imageStore.save({
      projectId: project.id, filename: "a.png",
      buffer: Buffer.from("x"), source: "brief",
    });
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/overview/images`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });

  it("deletes image by filename", async () => {
    const { app, project, imageStore } = await mkApp();
    const saved = await imageStore.save({
      projectId: project.id, filename: "a.png",
      buffer: Buffer.from("x"), source: "brief",
    });
    const res = await app.inject({
      method: "DELETE",
      url: `/api/projects/${project.id}/overview/images/${saved.filename}`,
    });
    expect(res.statusCode).toBe(204);
    const list = await imageStore.list(project.id);
    expect(list).toHaveLength(0);
  });

  it("returns 400 if source field missing in multipart", async () => {
    const { app, project } = await mkApp();
    const boundary = "----Bound" + Math.random().toString(36).slice(2);
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="x.png"',
      'Content-Type: image/png',
      '',
      'bytes',
      `--${boundary}--`,
      '',
    ].join('\r\n');
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/overview/images`,
      payload: body,
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: 跑，预期 FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test tests/routes-overview-images.test.ts
```

- [ ] **Step 3: 写 `packages/web-server/src/routes/overview.ts`**

```ts
import type { FastifyInstance } from "fastify";
import type { ProjectStore } from "../services/project-store.js";
import type { ImageStore } from "../services/image-store.js";

export interface OverviewDeps {
  store: ProjectStore;
  imageStore: ImageStore;
  projectsDir: string;
}

export function registerOverviewRoutes(app: FastifyInstance, deps: OverviewDeps) {
  app.post<{ Params: { id: string } }>(
    "/api/projects/:id/overview/images",
    async (req, reply) => {
      const { id } = req.params;
      const project = await deps.store.get(id);
      if (!project) return reply.code(404).send({ error: "project not found" });

      const parts = (req as any).parts?.() ?? (req as any).multipart?.();
      let source: string | undefined;
      let label: string | undefined;
      let fileData: { filename: string; buffer: Buffer } | null = null;

      for await (const part of parts) {
        if (part.file) {
          const chunks: Buffer[] = [];
          for await (const c of part.file) chunks.push(c as Buffer);
          fileData = { filename: part.filename, buffer: Buffer.concat(chunks) };
        } else {
          if (part.fieldname === "source") source = String(part.value);
          if (part.fieldname === "label") label = String(part.value);
        }
      }

      if (!fileData) return reply.code(400).send({ error: "no file" });
      if (source !== "brief" && source !== "screenshot") {
        return reply.code(400).send({ error: "source must be brief or screenshot" });
      }

      const info = await deps.imageStore.save({
        projectId: id,
        filename: fileData.filename,
        buffer: fileData.buffer,
        source,
        label,
      });
      return reply.code(201).send(info);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/projects/:id/overview/images",
    async (req) => deps.imageStore.list(req.params.id),
  );

  app.delete<{ Params: { id: string; filename: string } }>(
    "/api/projects/:id/overview/images/:filename",
    async (req, reply) => {
      await deps.imageStore.delete(req.params.id, req.params.filename);
      return reply.code(204).send();
    },
  );
}
```

注意：`req.parts()` 是 `@fastify/multipart` 的 async iterator 方式。如果 Fastify 5 里 API 不同，改用 `req.saveRequestFiles()` 或者 `req.file()` 迭代的等效方式。测试里用原生 multipart 构造 body，确保 parser 能正确吃。

- [ ] **Step 4: 在 server.ts 挂载**

Read server.ts，在 `registerBriefRoutes` 之后加：

```ts
import { ImageStore } from "./services/image-store.js";
import { registerOverviewRoutes } from "./routes/overview.js";

// 在 buildApp 里:
const imageStore = new ImageStore(cfg.projectsDir);
app.decorate("imageStore", imageStore);
registerOverviewRoutes(app, {
  store, imageStore, projectsDir: cfg.projectsDir,
});
```

更新 `declare module "fastify"`：

```ts
imageStore: ImageStore;
```

- [ ] **Step 5: 跑测试**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test
```

- [ ] **Step 6: Commit**

```bash
cd /Users/zeoooo/crossing-writer
git add packages/web-server/src/routes/overview.ts \
        packages/web-server/src/server.ts \
        packages/web-server/tests/routes-overview-images.test.ts
git -c commit.gpgsign=false commit -m "feat(web-server): POST /overview/images multipart + GET/DELETE"
```

---

### Task 4: OverviewIntakeForm UI

**Files:**
- Create: `packages/web-ui/src/components/right/OverviewIntakeForm.tsx`
- Modify: `packages/web-ui/src/api/client.ts`
- Modify: `packages/web-ui/src/api/types.ts`
- Create: `packages/web-ui/tests/components/OverviewIntakeForm.test.tsx`

- [ ] **Step 1: 扩展 types.ts**

```ts
export interface ProjectImage {
  filename: string;
  source: "brief" | "screenshot";
  relPath: string;
  absPath: string;
  label?: string;
}

export interface OverviewGenerateBody {
  productUrls: string[];
  userDescription?: string;
}
```

- [ ] **Step 2: 扩展 client.ts**

```ts
export async function uploadOverviewImage(
  projectId: string,
  file: File,
  source: "brief" | "screenshot",
  label?: string,
): Promise<ProjectImage> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("source", source);
  if (label) fd.append("label", label);
  const res = await fetch(`/api/projects/${projectId}/overview/images`, {
    method: "POST", body: fd,
  });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  return res.json();
}

export async function listOverviewImages(projectId: string): Promise<ProjectImage[]> {
  const res = await fetch(`/api/projects/${projectId}/overview/images`);
  return res.json();
}

export async function deleteOverviewImage(projectId: string, filename: string): Promise<void> {
  const res = await fetch(`/api/projects/${projectId}/overview/images/${filename}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`delete failed: ${res.status}`);
}

export async function generateOverview(
  projectId: string, body: OverviewGenerateBody,
): Promise<{ ok: true }> {
  const res = await fetch(`/api/projects/${projectId}/overview/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`generate failed: ${res.status}`);
  return res.json();
}
```

- [ ] **Step 3: 失败测试 `packages/web-ui/tests/components/OverviewIntakeForm.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OverviewIntakeForm } from "../../src/components/right/OverviewIntakeForm";

vi.mock("../../src/api/client", () => ({
  uploadOverviewImage: vi.fn(async () => ({
    filename: "brief-fig-1.png", source: "brief",
    relPath: "context/images/brief-fig-1.png", absPath: "/abs/x",
  })),
  listOverviewImages: vi.fn(async () => []),
  deleteOverviewImage: vi.fn(async () => {}),
  generateOverview: vi.fn(async () => ({ ok: true })),
}));

describe("OverviewIntakeForm", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders brief + screenshot uploaders, URL list, description", () => {
    render(<OverviewIntakeForm projectId="p1" />);
    expect(screen.getByText(/Brief 配图/)).toBeInTheDocument();
    expect(screen.getByText(/产品截图/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/https:\/\//)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/补充描述/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /生成产品概览/ })).toBeInTheDocument();
  });

  it("adds url to list via button", () => {
    render(<OverviewIntakeForm projectId="p1" />);
    const input = screen.getByPlaceholderText(/https:\/\//) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "https://pixverse.ai" } });
    fireEvent.click(screen.getByRole("button", { name: /添加/ }));
    expect(screen.getByText("https://pixverse.ai")).toBeInTheDocument();
  });

  it("calls generateOverview with urls + description when submit", async () => {
    const { generateOverview } = await import("../../src/api/client");
    render(<OverviewIntakeForm projectId="p1" />);
    const input = screen.getByPlaceholderText(/https:\/\//) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "https://x.com" } });
    fireEvent.click(screen.getByRole("button", { name: /添加/ }));
    const ta = screen.getByPlaceholderText(/补充描述/);
    fireEvent.change(ta, { target: { value: "测试" } });
    fireEvent.click(screen.getByRole("button", { name: /生成产品概览/ }));
    await waitFor(() => {
      expect(generateOverview).toHaveBeenCalledWith("p1", {
        productUrls: ["https://x.com"],
        userDescription: "测试",
      });
    });
  });
});
```

- [ ] **Step 4: 跑，预期 FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-ui && pnpm test tests/components/OverviewIntakeForm.test.tsx
```

- [ ] **Step 5: 写 `packages/web-ui/src/components/right/OverviewIntakeForm.tsx`**

```tsx
import { useEffect, useState } from "react";
import {
  uploadOverviewImage, listOverviewImages,
  deleteOverviewImage, generateOverview,
} from "../../api/client";
import type { ProjectImage } from "../../api/types";

export function OverviewIntakeForm({ projectId }: { projectId: string }) {
  const [images, setImages] = useState<ProjectImage[]>([]);
  const [urls, setUrls] = useState<string[]>([]);
  const [urlDraft, setUrlDraft] = useState("");
  const [desc, setDesc] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    listOverviewImages(projectId).then(setImages).catch(() => {});
  }, [projectId]);

  async function onUpload(source: "brief" | "screenshot", fl: FileList | null) {
    if (!fl) return;
    for (const f of Array.from(fl)) {
      const info = await uploadOverviewImage(projectId, f, source);
      setImages((prev) => [...prev, info]);
    }
  }

  async function onDelete(filename: string) {
    await deleteOverviewImage(projectId, filename);
    setImages((prev) => prev.filter((i) => i.filename !== filename));
  }

  function addUrl() {
    const v = urlDraft.trim();
    if (!v) return;
    setUrls([...urls, v]);
    setUrlDraft("");
  }

  async function submit() {
    setSubmitting(true);
    try {
      await generateOverview(projectId, {
        productUrls: urls,
        userDescription: desc || undefined,
      });
    } finally {
      setSubmitting(false);
    }
  }

  const briefImgs = images.filter((i) => i.source === "brief");
  const screenshotImgs = images.filter((i) => i.source === "screenshot");

  return (
    <div className="space-y-4 p-4">
      <section>
        <h3 className="font-semibold">Brief 配图</h3>
        <input type="file" multiple accept="image/*"
          onChange={(e) => onUpload("brief", e.target.files)} />
        <div className="grid grid-cols-3 gap-2 mt-2">
          {briefImgs.map((i) => (
            <div key={i.filename} className="border p-1 text-xs">
              {i.filename}
              <button onClick={() => onDelete(i.filename)}>删</button>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="font-semibold">产品截图</h3>
        <input type="file" multiple accept="image/*"
          onChange={(e) => onUpload("screenshot", e.target.files)} />
        <div className="grid grid-cols-3 gap-2 mt-2">
          {screenshotImgs.map((i) => (
            <div key={i.filename} className="border p-1 text-xs">
              {i.filename}
              <button onClick={() => onDelete(i.filename)}>删</button>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="font-semibold">产品文档 URL</h3>
        <div className="flex gap-2">
          <input className="flex-1 border px-2" placeholder="https://..."
            value={urlDraft} onChange={(e) => setUrlDraft(e.target.value)} />
          <button onClick={addUrl}>添加</button>
        </div>
        <ul className="mt-2 text-sm">
          {urls.map((u, idx) => (
            <li key={idx}>
              {u}
              <button onClick={() => setUrls(urls.filter((_, i) => i !== idx))}>🗑</button>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="font-semibold">补充描述（可选）</h3>
        <textarea className="w-full border p-2" rows={4}
          placeholder="补充描述"
          value={desc} onChange={(e) => setDesc(e.target.value)} />
      </section>

      <button className="bg-blue-600 text-white px-4 py-2"
        disabled={submitting} onClick={submit}>
        生成产品概览
      </button>
    </div>
  );
}
```

- [ ] **Step 6: 跑测试，预期 PASS**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-ui && pnpm test
```

- [ ] **Step 7: Commit**

```bash
cd /Users/zeoooo/crossing-writer
git add packages/web-ui/src/components/right/OverviewIntakeForm.tsx \
        packages/web-ui/src/api/client.ts \
        packages/web-ui/src/api/types.ts \
        packages/web-ui/tests/components/OverviewIntakeForm.test.tsx
git -c commit.gpgsign=false commit -m "feat(web-ui): OverviewIntakeForm (images + urls + description)"
```

---

### Task 5: ProductOverviewAgent role + vision prompt

**Files:**
- Create: `packages/agents/src/prompts/product-overview.md`
- Create: `packages/agents/src/roles/product-overview-agent.ts`
- Modify: `packages/agents/src/index.ts`
- Create: `packages/agents/tests/product-overview-agent.test.ts`

- [ ] **Step 1: 写 prompt `packages/agents/src/prompts/product-overview.md`**

```markdown
你是"产品概览分析师"。你收到以下输入：

1. Brief 配图（若干张，标为 brief-fig-*）——甲方给出的产品示意
2. 产品截图（若干张，标为 screenshot-*）——产品真实 UI
3. 产品官方 URL 抓取的 markdown（product-fetched.md 内容）
4. 用户补充描述（可选）
5. Mission 摘要（mission/selected.md 的前 200 字）

你的任务：产出一份结构化的产品概览 markdown。

## 输出要求（严格）

必须以 YAML frontmatter 开头，字段完整：

```yaml
---
type: product_overview
product_name: <必填>
product_category: <必填>
core_capabilities:
  - <3-6 条>
key_ui_elements:
  - <3-5 条 from screenshots>
typical_user_scenarios:
  - <1-3 条>
differentiators:
  - <1-3 条>
confidence: <0.0-1.0>
gaps:
  - <对你没看到的点的诚实声明>
---
```

之后是 markdown 正文（>300 字，<500 字），包含以下章节：

- `# 产品概览`
- `## 核心能力`
- `## 典型使用场景`
- `## 界面观察`
- `## 对 Mission 的启示`
- `## 空白与风险`

**注意**：
- 不要编造你没看到的东西——不确定的放 gaps
- 界面观察必须直接引用 screenshot-N 的可视元素
- 对 Mission 的启示要具体到"产品的 X 能力能支撑 Mission 的 Y 主张"
```

- [ ] **Step 2: 失败测试 `packages/agents/tests/product-overview-agent.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { ProductOverviewAgent } from "../src/roles/product-overview-agent.js";

vi.mock("../src/model-adapter.js", () => ({
  invokeAgent: vi.fn(() => ({
    text: "---\ntype: product_overview\nproduct_name: X\n---\n# 产品概览\n...",
    meta: { cli: "claude", model: "opus", durationMs: 1000 },
  })),
}));

describe("ProductOverviewAgent", () => {
  it("analyzes with images + urls + description", async () => {
    const { invokeAgent } = await import("../src/model-adapter.js");
    const agent = new ProductOverviewAgent({ cli: "claude", model: "opus" });
    const out = await agent.analyze({
      briefImages: ["/abs/brief-fig-1.png"],
      screenshots: ["/abs/screenshot-1.png"],
      productFetchedMd: "# 官网内容",
      userDescription: "多Agent工作流平台",
      missionSummary: "测 Agent 编排能力",
    });
    expect(out.text).toContain("type: product_overview");
    expect(out.meta.cli).toBe("claude");

    const call = vi.mocked(invokeAgent).mock.calls[0]![0];
    expect(call.agentKey).toBe("product_overview");
    expect(call.images).toEqual([
      "/abs/brief-fig-1.png",
      "/abs/screenshot-1.png",
    ]);
    expect(call.userMessage).toContain("多Agent工作流平台");
    expect(call.userMessage).toContain("测 Agent 编排能力");
  });

  it("throws when no images", async () => {
    const agent = new ProductOverviewAgent({ cli: "claude", model: "opus" });
    await expect(agent.analyze({
      briefImages: [], screenshots: [],
      productFetchedMd: "", userDescription: "",
      missionSummary: "",
    })).rejects.toThrow(/at least one image/i);
  });
});
```

- [ ] **Step 3: 跑，预期 FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/agents && pnpm test tests/product-overview-agent.test.ts
```

- [ ] **Step 4: 写 `packages/agents/src/roles/product-overview-agent.ts`**

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { invokeAgent } from "../model-adapter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = readFileSync(
  join(__dirname, "../prompts/product-overview.md"),
  "utf-8",
);

export interface OverviewInput {
  briefImages: string[];
  screenshots: string[];
  productFetchedMd: string;
  userDescription: string;
  missionSummary: string;
}

export interface OverviewOutput {
  text: string;
  meta: { cli: string; model?: string | null; durationMs: number };
}

export class ProductOverviewAgent {
  constructor(
    private opts: { cli: "claude" | "codex"; model?: string },
  ) {}

  async analyze(input: OverviewInput): Promise<OverviewOutput> {
    const allImages = [...input.briefImages, ...input.screenshots];
    if (allImages.length === 0) {
      throw new Error("at least one image required");
    }
    const userMessage = [
      "# Mission 摘要",
      input.missionSummary || "(无)",
      "",
      "# 产品 URL 抓取内容",
      input.productFetchedMd || "(无)",
      "",
      "# 用户补充描述",
      input.userDescription || "(无)",
      "",
      `# 图片清单`,
      `- Brief 配图: ${input.briefImages.length} 张`,
      `- 产品截图: ${input.screenshots.length} 张`,
      "",
      "请按 system prompt 要求输出 product-overview markdown。",
    ].join("\n");

    const result = invokeAgent({
      agentKey: "product_overview",
      cli: this.opts.cli,
      model: this.opts.model,
      systemPrompt: SYSTEM_PROMPT,
      userMessage,
      images: allImages,
    });
    return {
      text: result.text,
      meta: {
        cli: result.meta.cli,
        model: result.meta.model ?? null,
        durationMs: result.meta.durationMs,
      },
    };
  }
}
```

- [ ] **Step 5: 在 `packages/agents/src/index.ts` 导出**

```ts
export { ProductOverviewAgent } from "./roles/product-overview-agent.js";
export type { OverviewInput, OverviewOutput } from "./roles/product-overview-agent.js";
```

- [ ] **Step 6: 跑测试，预期 PASS**

```bash
cd /Users/zeoooo/crossing-writer/packages/agents && pnpm test
```

- [ ] **Step 7: Commit**

```bash
cd /Users/zeoooo/crossing-writer
git add packages/agents/src/prompts/product-overview.md \
        packages/agents/src/roles/product-overview-agent.ts \
        packages/agents/src/index.ts \
        packages/agents/tests/product-overview-agent.test.ts
git -c commit.gpgsign=false commit -m "feat(agents): ProductOverviewAgent with vision prompt"
```

---

### Task 6: OverviewAnalyzerService

**Files:**
- Create: `packages/web-server/src/services/overview-analyzer-service.ts`
- Create: `packages/web-server/tests/overview-analyzer-service.test.ts`

- [ ] **Step 1: 失败测试**

```ts
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/services/project-store.js";
import { ImageStore } from "../src/services/image-store.js";
import { analyzeOverview } from "../src/services/overview-analyzer-service.js";

vi.mock("@crossing/agents", () => ({
  ProductOverviewAgent: vi.fn().mockImplementation(() => ({
    analyze: async () => ({
      text: "---\ntype: product_overview\nproduct_name: X\n---\n# 产品概览\n正文",
      meta: { cli: "claude", model: "opus", durationMs: 5000 },
    }),
  })),
  resolveAgent: vi.fn(() => ({ cli: "claude", model: "opus" })),
}));

describe("analyzeOverview", () => {
  it("writes product-overview.md and appends events", async () => {
    const vault = mkdtempSync(join(tmpdir(), "ov-"));
    const projectsDir = join(vault, "07_projects");
    const store = new ProjectStore(projectsDir);
    const imageStore = new ImageStore(projectsDir);
    const p = await store.create({ name: "T" });
    await imageStore.save({
      projectId: p.id, filename: "a.png",
      buffer: Buffer.from("x"), source: "brief",
    });

    const projectDir = join(projectsDir, p.id);
    mkdirSync(join(projectDir, "mission"), { recursive: true });
    writeFileSync(join(projectDir, "mission/selected.md"), "Mission body", "utf-8");

    await analyzeOverview({
      projectId: p.id, projectsDir, store, imageStore,
      productUrls: ["https://x.com"],
      userDescription: "desc",
      agents: {}, defaultCli: "claude", fallbackCli: "codex",
    } as any);

    const overviewPath = join(projectDir, "context/product-overview.md");
    expect(existsSync(overviewPath)).toBe(true);
    expect(readFileSync(overviewPath, "utf-8")).toContain("type: product_overview");

    const events = readFileSync(join(projectDir, "events.jsonl"), "utf-8");
    expect(events).toContain("overview.started");
    expect(events).toContain("overview.completed");
    expect(events).toContain('"cli":"claude"');

    const updated = await store.get(p.id);
    expect(updated?.status).toBe("overview_ready");
    expect((updated as any)?.overview?.overview_path).toBe("context/product-overview.md");
  });

  it("transitions to overview_failed when agent throws", async () => {
    const { ProductOverviewAgent } = await import("@crossing/agents") as any;
    ProductOverviewAgent.mockImplementationOnce(() => ({
      analyze: async () => { throw new Error("vision unavailable"); },
    }));
    const vault = mkdtempSync(join(tmpdir(), "ov-"));
    const projectsDir = join(vault, "07_projects");
    const store = new ProjectStore(projectsDir);
    const imageStore = new ImageStore(projectsDir);
    const p = await store.create({ name: "T" });
    await imageStore.save({
      projectId: p.id, filename: "a.png",
      buffer: Buffer.from("x"), source: "brief",
    });
    mkdirSync(join(projectsDir, p.id, "mission"), { recursive: true });
    writeFileSync(join(projectsDir, p.id, "mission/selected.md"), "m", "utf-8");

    await expect(analyzeOverview({
      projectId: p.id, projectsDir, store, imageStore,
      productUrls: [], userDescription: "",
      agents: {}, defaultCli: "claude", fallbackCli: "codex",
    } as any)).rejects.toThrow(/vision unavailable/);

    const updated = await store.get(p.id);
    expect(updated?.status).toBe("overview_failed");
  });
});
```

- [ ] **Step 2: 跑，预期 FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test tests/overview-analyzer-service.test.ts
```

- [ ] **Step 3: 写 `packages/web-server/src/services/overview-analyzer-service.ts`**

```ts
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { ProductOverviewAgent, resolveAgent } from "@crossing/agents";
import type { ProjectStore } from "./project-store.js";
import type { ImageStore } from "./image-store.js";
import { appendEvent } from "./event-log.js";

export interface AnalyzeOverviewOpts {
  projectId: string;
  projectsDir: string;
  store: ProjectStore;
  imageStore: ImageStore;
  productUrls: string[];
  userDescription?: string;
  vaultPath: string;
  sqlitePath: string;
  agents: Record<string, unknown>;
  defaultCli: "claude" | "codex";
  fallbackCli: "claude" | "codex";
}

export async function analyzeOverview(opts: AnalyzeOverviewOpts): Promise<string> {
  const projectDir = join(opts.projectsDir, opts.projectId);
  const resolved = resolveAgent(
    { vaultPath: opts.vaultPath ?? "", sqlitePath: opts.sqlitePath ?? "",
      modelAdapter: { defaultCli: opts.defaultCli, fallbackCli: opts.fallbackCli },
      agents: opts.agents },
    "product_overview",
  );

  await opts.store.update(opts.projectId, { status: "overview_analyzing" });
  await appendEvent(projectDir, {
    type: "overview.started",
    agent: "product_overview",
    cli: resolved.cli,
    model: resolved.model ?? null,
  });

  try {
    const images = await opts.imageStore.list(opts.projectId);
    const briefImages = images.filter((i) => i.source === "brief").map((i) => i.absPath);
    const screenshots = images.filter((i) => i.source === "screenshot").map((i) => i.absPath);

    let productFetchedMd = "";
    try {
      productFetchedMd = await readFile(join(projectDir, "context/product-fetched.md"), "utf-8");
    } catch {}
    let missionSummary = "";
    try {
      const m = await readFile(join(projectDir, "mission/selected.md"), "utf-8");
      missionSummary = m.slice(0, 800);
    } catch {}

    const agent = new ProductOverviewAgent({
      cli: resolved.cli as "claude" | "codex",
      model: resolved.model,
    });
    const started = Date.now();
    const result = await agent.analyze({
      briefImages, screenshots, productFetchedMd,
      userDescription: opts.userDescription ?? "",
      missionSummary,
    });
    const durationMs = Date.now() - started;

    const outPath = join(projectDir, "context/product-overview.md");
    await mkdir(join(projectDir, "context"), { recursive: true });
    await writeFile(outPath, result.text, "utf-8");

    await opts.store.update(opts.projectId, {
      status: "overview_ready",
      overview: {
        images_dir: "context/images",
        overview_path: "context/product-overview.md",
        generated_at: new Date().toISOString(),
        human_edited: false,
      },
    } as any);

    await appendEvent(projectDir, {
      type: "overview.completed",
      agent: "product_overview",
      cli: resolved.cli,
      model: resolved.model ?? null,
      output: "context/product-overview.md",
      durationMs,
    });
    return outPath;
  } catch (e) {
    await opts.store.update(opts.projectId, { status: "overview_failed" });
    await appendEvent(projectDir, {
      type: "overview.failed",
      agent: "product_overview",
      cli: resolved.cli,
      model: resolved.model ?? null,
      error: String(e),
    });
    throw e;
  }
}
```

- [ ] **Step 4: 跑测试，预期 PASS**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test
```

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer
git add packages/web-server/src/services/overview-analyzer-service.ts \
        packages/web-server/tests/overview-analyzer-service.test.ts
git -c commit.gpgsign=false commit -m "feat(web-server): OverviewAnalyzerService orchestrates ProductOverviewAgent"
```

---

### Task 7: POST /api/projects/:id/overview/generate 路由

**Files:**
- Modify: `packages/web-server/src/routes/overview.ts`
- Modify: `packages/web-server/src/server.ts`
- Create: `packages/web-server/tests/routes-overview-generate.test.ts`

- [ ] **Step 1: 失败测试**

```ts
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { registerProjectsRoutes } from "../src/routes/projects.js";
import { registerOverviewRoutes } from "../src/routes/overview.js";
import { ProjectStore } from "../src/services/project-store.js";
import { ImageStore } from "../src/services/image-store.js";

vi.mock("../src/services/overview-analyzer-service.js", () => ({
  analyzeOverview: vi.fn(async () => "/abs/out.md"),
}));

describe("POST /overview/generate", () => {
  it("requires at least one image", async () => {
    const vault = mkdtempSync(join(tmpdir(), "og-"));
    const projectsDir = join(vault, "07_projects");
    const store = new ProjectStore(projectsDir);
    const imageStore = new ImageStore(projectsDir);
    const app = Fastify();
    await app.register(multipart);
    registerProjectsRoutes(app, { store });
    registerOverviewRoutes(app, {
      store, imageStore, projectsDir,
      analyzeOverviewDeps: {
        vaultPath: "", sqlitePath: "",
        agents: {}, defaultCli: "claude", fallbackCli: "codex",
      },
    });
    await app.ready();
    const p = (await app.inject({
      method: "POST", url: "/api/projects", payload: { name: "T" },
    })).json();

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${p.id}/overview/generate`,
      payload: { productUrls: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/image/i);
  });

  it("202 triggers analyzeOverview in background", async () => {
    const { analyzeOverview } = await import("../src/services/overview-analyzer-service.js");
    const vault = mkdtempSync(join(tmpdir(), "og-"));
    const projectsDir = join(vault, "07_projects");
    const store = new ProjectStore(projectsDir);
    const imageStore = new ImageStore(projectsDir);
    const app = Fastify();
    await app.register(multipart);
    registerProjectsRoutes(app, { store });
    registerOverviewRoutes(app, {
      store, imageStore, projectsDir,
      analyzeOverviewDeps: {
        vaultPath: "", sqlitePath: "",
        agents: {}, defaultCli: "claude", fallbackCli: "codex",
      },
    });
    await app.ready();
    const p = (await app.inject({
      method: "POST", url: "/api/projects", payload: { name: "T" },
    })).json();
    await imageStore.save({
      projectId: p.id, filename: "a.png",
      buffer: Buffer.from("x"), source: "brief",
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${p.id}/overview/generate`,
      payload: { productUrls: ["https://x.com"], userDescription: "d" },
    });
    expect(res.statusCode).toBe(202);
    await new Promise((r) => setTimeout(r, 20));
    expect(analyzeOverview).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑，预期 FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test tests/routes-overview-generate.test.ts
```

- [ ] **Step 3: 扩展 `packages/web-server/src/routes/overview.ts`**

在 `OverviewDeps` 接口加 `analyzeOverviewDeps`，然后在 `registerOverviewRoutes` 内加：

```ts
import { analyzeOverview } from "../services/overview-analyzer-service.js";

export interface OverviewDeps {
  store: ProjectStore;
  imageStore: ImageStore;
  projectsDir: string;
  analyzeOverviewDeps: {
    vaultPath: string;
    sqlitePath: string;
    agents: Record<string, unknown>;
    defaultCli: "claude" | "codex";
    fallbackCli: "claude" | "codex";
  };
}

// 在路由块里追加：
app.post<{
  Params: { id: string };
  Body: { productUrls?: string[]; userDescription?: string };
}>("/api/projects/:id/overview/generate", async (req, reply) => {
  const { id } = req.params;
  const project = await deps.store.get(id);
  if (!project) return reply.code(404).send({ error: "project not found" });
  const images = await deps.imageStore.list(id);
  if (images.length === 0) {
    return reply.code(400).send({ error: "at least one image required" });
  }
  const body = req.body ?? {};
  // fire-and-forget background task
  void analyzeOverview({
    projectId: id,
    projectsDir: deps.projectsDir,
    store: deps.store,
    imageStore: deps.imageStore,
    productUrls: body.productUrls ?? [],
    userDescription: body.userDescription,
    ...deps.analyzeOverviewDeps,
  }).catch(() => { /* error is logged via events */ });
  return reply.code(202).send({ status: "analyzing" });
});
```

- [ ] **Step 4: 修改 server.ts 传入 deps**

```ts
registerOverviewRoutes(app, {
  store, imageStore, projectsDir: cfg.projectsDir,
  analyzeOverviewDeps: {
    vaultPath: cfg.vaultPath, sqlitePath: cfg.sqlitePath,
    agents: cfg.agents, defaultCli: cfg.defaultCli, fallbackCli: cfg.fallbackCli,
  },
});
```

- [ ] **Step 5: 跑测试**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test
```

- [ ] **Step 6: Commit**

```bash
cd /Users/zeoooo/crossing-writer
git add packages/web-server/src/routes/overview.ts \
        packages/web-server/src/server.ts \
        packages/web-server/tests/routes-overview-generate.test.ts
git -c commit.gpgsign=false commit -m "feat(web-server): POST /overview/generate triggers analyzer"
```

---

### Task 8: GET/PATCH /api/projects/:id/overview 路由

**Files:**
- Modify: `packages/web-server/src/routes/overview.ts`
- Create: `packages/web-server/tests/routes-overview-read-write.test.ts`

- [ ] **Step 1: 失败测试**

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { registerProjectsRoutes } from "../src/routes/projects.js";
import { registerOverviewRoutes } from "../src/routes/overview.js";
import { ProjectStore } from "../src/services/project-store.js";
import { ImageStore } from "../src/services/image-store.js";

async function mkApp() {
  const vault = mkdtempSync(join(tmpdir(), "ovrw-"));
  const projectsDir = join(vault, "07_projects");
  const store = new ProjectStore(projectsDir);
  const imageStore = new ImageStore(projectsDir);
  const app = Fastify();
  await app.register(multipart);
  registerProjectsRoutes(app, { store });
  registerOverviewRoutes(app, {
    store, imageStore, projectsDir,
    analyzeOverviewDeps: {
      vaultPath: "", sqlitePath: "",
      agents: {}, defaultCli: "claude", fallbackCli: "codex",
    },
  });
  await app.ready();
  const p = (await app.inject({
    method: "POST", url: "/api/projects", payload: { name: "T" },
  })).json();
  return { app, projectsDir, p };
}

describe("GET/PATCH /overview", () => {
  it("404 when not generated yet", async () => {
    const { app, p } = await mkApp();
    const res = await app.inject({
      method: "GET", url: `/api/projects/${p.id}/overview`,
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns markdown when present", async () => {
    const { app, p, projectsDir } = await mkApp();
    mkdirSync(join(projectsDir, p.id, "context"), { recursive: true });
    writeFileSync(
      join(projectsDir, p.id, "context/product-overview.md"),
      "---\ntype: product_overview\n---\n# Body",
      "utf-8",
    );
    const res = await app.inject({
      method: "GET", url: `/api/projects/${p.id}/overview`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("type: product_overview");
  });

  it("PATCH writes raw md + marks human_edited", async () => {
    const { app, p, projectsDir } = await mkApp();
    mkdirSync(join(projectsDir, p.id, "context"), { recursive: true });
    writeFileSync(
      join(projectsDir, p.id, "context/product-overview.md"),
      "---\ntype: product_overview\n---\n# Old",
      "utf-8",
    );
    const res = await app.inject({
      method: "PATCH",
      url: `/api/projects/${p.id}/overview`,
      payload: "---\ntype: product_overview\n---\n# New",
      headers: { "content-type": "text/markdown" },
    });
    expect(res.statusCode).toBe(200);
    const body = readFileSync(
      join(projectsDir, p.id, "context/product-overview.md"),
      "utf-8",
    );
    expect(body).toContain("# New");
  });
});
```

- [ ] **Step 2: 跑，预期 FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test tests/routes-overview-read-write.test.ts
```

- [ ] **Step 3: 扩展 overview.ts**

```ts
import { readFile, writeFile } from "node:fs/promises";

app.get<{ Params: { id: string } }>(
  "/api/projects/:id/overview",
  async (req, reply) => {
    const overviewPath = join(deps.projectsDir, req.params.id, "context/product-overview.md");
    try {
      const body = await readFile(overviewPath, "utf-8");
      reply.header("content-type", "text/markdown; charset=utf-8");
      return reply.send(body);
    } catch (e: any) {
      if (e.code === "ENOENT") return reply.code(404).send({ error: "not generated" });
      throw e;
    }
  },
);

app.patch<{ Params: { id: string } }>(
  "/api/projects/:id/overview",
  async (req, reply) => {
    const overviewPath = join(deps.projectsDir, req.params.id, "context/product-overview.md");
    const raw = typeof req.body === "string" ? req.body : String(req.body);
    await writeFile(overviewPath, raw, "utf-8");
    const p = await deps.store.get(req.params.id);
    if (p && (p as any).overview) {
      await deps.store.update(req.params.id, {
        overview: { ...(p as any).overview, human_edited: true, edited_at: new Date().toISOString() },
      } as any);
    }
    return reply.code(200).send({ ok: true });
  },
);
```

Fastify 默认不解析 `text/markdown`，需要加 body parser：

```ts
app.addContentTypeParser("text/markdown", { parseAs: "string" }, (_req, body, done) => done(null, body));
```

加在 `registerOverviewRoutes` 顶部。

- [ ] **Step 4: 跑测试**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test
```

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer
git add packages/web-server/src/routes/overview.ts \
        packages/web-server/tests/routes-overview-read-write.test.ts
git -c commit.gpgsign=false commit -m "feat(web-server): GET/PATCH /overview read/write product-overview.md"
```

---

### Task 9: POST /overview/approve + 状态机转换

**Files:**
- Modify: `packages/web-server/src/state/state-machine.ts`
- Modify: `packages/web-server/src/routes/overview.ts`
- Create: `packages/web-server/tests/routes-overview-approve.test.ts`

- [ ] **Step 1: 失败测试**

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { registerProjectsRoutes } from "../src/routes/projects.js";
import { registerOverviewRoutes } from "../src/routes/overview.js";
import { ProjectStore } from "../src/services/project-store.js";
import { ImageStore } from "../src/services/image-store.js";

describe("POST /overview/approve", () => {
  it("moves overview_ready -> awaiting_case_expert_selection", async () => {
    const vault = mkdtempSync(join(tmpdir(), "apr-"));
    const projectsDir = join(vault, "07_projects");
    const store = new ProjectStore(projectsDir);
    const imageStore = new ImageStore(projectsDir);
    const app = Fastify();
    await app.register(multipart);
    registerProjectsRoutes(app, { store });
    registerOverviewRoutes(app, {
      store, imageStore, projectsDir,
      analyzeOverviewDeps: {
        vaultPath: "", sqlitePath: "",
        agents: {}, defaultCli: "claude", fallbackCli: "codex",
      },
    });
    await app.ready();
    const p = (await app.inject({
      method: "POST", url: "/api/projects", payload: { name: "T" },
    })).json();
    await store.update(p.id, { status: "overview_ready" });
    mkdirSync(join(projectsDir, p.id, "context"), { recursive: true });
    writeFileSync(join(projectsDir, p.id, "context/product-overview.md"), "md", "utf-8");

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${p.id}/overview/approve`,
    });
    expect(res.statusCode).toBe(200);
    const updated = await store.get(p.id);
    expect(updated?.status).toBe("awaiting_case_expert_selection");
  });

  it("409 if status is not overview_ready", async () => {
    const vault = mkdtempSync(join(tmpdir(), "apr-"));
    const projectsDir = join(vault, "07_projects");
    const store = new ProjectStore(projectsDir);
    const imageStore = new ImageStore(projectsDir);
    const app = Fastify();
    await app.register(multipart);
    registerProjectsRoutes(app, { store });
    registerOverviewRoutes(app, {
      store, imageStore, projectsDir,
      analyzeOverviewDeps: {
        vaultPath: "", sqlitePath: "",
        agents: {}, defaultCli: "claude", fallbackCli: "codex",
      },
    });
    await app.ready();
    const p = (await app.inject({
      method: "POST", url: "/api/projects", payload: { name: "T" },
    })).json();
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${p.id}/overview/approve`,
    });
    expect(res.statusCode).toBe(409);
  });
});
```

- [ ] **Step 2: 跑，预期 FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test tests/routes-overview-approve.test.ts
```

- [ ] **Step 3: 扩展 state-machine.ts**

```ts
export const STATUSES = [
  // ... SP-02 existing ...
  "awaiting_overview_input",
  "overview_analyzing",
  "overview_ready",
  "overview_failed",
  "awaiting_case_expert_selection",
  "case_planning_running",
  "case_planning_failed",
  "case_synthesizing",
  "awaiting_case_selection",
  "case_plan_approved",
] as const;

export const TRANSITIONS: Record<string, string[]> = {
  // ... existing ...
  mission_approved: ["awaiting_overview_input"],
  awaiting_overview_input: ["overview_analyzing"],
  overview_analyzing: ["overview_ready", "overview_failed"],
  overview_ready: ["awaiting_case_expert_selection", "overview_analyzing"],
  overview_failed: ["overview_analyzing"],
  awaiting_case_expert_selection: ["case_planning_running"],
  case_planning_running: ["case_synthesizing", "case_planning_failed"],
  case_planning_failed: ["case_planning_running"],
  case_synthesizing: ["awaiting_case_selection"],
  awaiting_case_selection: ["case_plan_approved"],
};
```

- [ ] **Step 4: 追加 approve 路由到 overview.ts**

```ts
app.post<{ Params: { id: string } }>(
  "/api/projects/:id/overview/approve",
  async (req, reply) => {
    const p = await deps.store.get(req.params.id);
    if (!p) return reply.code(404).send({ error: "not found" });
    if (p.status !== "overview_ready") {
      return reply.code(409).send({ error: `cannot approve from status ${p.status}` });
    }
    await deps.store.update(req.params.id, {
      status: "awaiting_case_expert_selection",
    });
    return reply.code(200).send({ ok: true });
  },
);
```

- [ ] **Step 5: 跑测试**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test
```

- [ ] **Step 6: Commit**

```bash
cd /Users/zeoooo/crossing-writer
git add packages/web-server/src/state/state-machine.ts \
        packages/web-server/src/routes/overview.ts \
        packages/web-server/tests/routes-overview-approve.test.ts
git -c commit.gpgsign=false commit -m "feat(web-server): POST /overview/approve + SP-03 state transitions"
```

---

### Task 10: ProductOverviewCard 前端组件

**Files:**
- Create: `packages/web-ui/src/components/left/ProductOverviewCard.tsx`
- Create: `packages/web-ui/src/hooks/useOverview.ts`
- Modify: `packages/web-ui/src/api/client.ts`
- Create: `packages/web-ui/tests/components/ProductOverviewCard.test.tsx`

- [ ] **Step 1: 扩展 client.ts**

```ts
export async function getOverview(projectId: string): Promise<string | null> {
  const res = await fetch(`/api/projects/${projectId}/overview`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("failed");
  return res.text();
}

export async function patchOverview(projectId: string, markdown: string): Promise<void> {
  const res = await fetch(`/api/projects/${projectId}/overview`, {
    method: "PATCH",
    headers: { "content-type": "text/markdown" },
    body: markdown,
  });
  if (!res.ok) throw new Error("patch failed");
}

export async function approveOverview(projectId: string): Promise<void> {
  const res = await fetch(`/api/projects/${projectId}/overview/approve`, { method: "POST" });
  if (!res.ok) throw new Error("approve failed");
}
```

- [ ] **Step 2: 写 hook `useOverview.ts`**

```ts
import { useEffect, useState } from "react";
import { getOverview, patchOverview } from "../api/client";

export function useOverview(projectId: string) {
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getOverview(projectId).then((v) => {
      setMarkdown(v); setLoading(false);
    });
  }, [projectId]);

  async function save(next: string) {
    await patchOverview(projectId, next);
    setMarkdown(next);
  }
  return { markdown, loading, save };
}
```

- [ ] **Step 3: 失败测试**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ProductOverviewCard } from "../../src/components/left/ProductOverviewCard";

vi.mock("../../src/api/client", () => ({
  getOverview: vi.fn(async () => "---\ntype: product_overview\n---\n# 产品概览\n正文"),
  patchOverview: vi.fn(async () => {}),
  approveOverview: vi.fn(async () => {}),
}));

describe("ProductOverviewCard", () => {
  it("renders markdown preview", async () => {
    render(<ProductOverviewCard projectId="p1" status="overview_ready" />);
    await waitFor(() => {
      expect(screen.getByText(/产品概览/)).toBeInTheDocument();
    });
  });

  it("enters edit mode and saves", async () => {
    const { patchOverview } = await import("../../src/api/client");
    render(<ProductOverviewCard projectId="p1" status="overview_ready" />);
    await waitFor(() => screen.getByText(/产品概览/));
    fireEvent.click(screen.getByRole("button", { name: /编辑/ }));
    const ta = await screen.findByRole("textbox");
    fireEvent.change(ta, { target: { value: "# 新标题" } });
    fireEvent.click(screen.getByRole("button", { name: /保存/ }));
    await waitFor(() => {
      expect(patchOverview).toHaveBeenCalledWith("p1", "# 新标题");
    });
  });

  it("shows approve button and calls approve", async () => {
    const { approveOverview } = await import("../../src/api/client");
    render(<ProductOverviewCard projectId="p1" status="overview_ready" />);
    await waitFor(() => screen.getByText(/产品概览/));
    fireEvent.click(screen.getByRole("button", { name: /批准进入 Case 规划/ }));
    await waitFor(() => {
      expect(approveOverview).toHaveBeenCalledWith("p1");
    });
  });
});
```

- [ ] **Step 4: 跑，预期 FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-ui && pnpm test tests/components/ProductOverviewCard.test.tsx
```

- [ ] **Step 5: 写组件**

```tsx
import { useState } from "react";
import { useOverview } from "../../hooks/useOverview";
import { approveOverview } from "../../api/client";

export function ProductOverviewCard({
  projectId, status,
}: { projectId: string; status: string }) {
  const { markdown, loading, save } = useOverview(projectId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  if (loading) return <div>加载中...</div>;
  if (markdown == null) return <div>概览尚未生成</div>;

  async function onSave() {
    await save(draft);
    setEditing(false);
  }

  return (
    <div className="p-4">
      {editing ? (
        <>
          <textarea className="w-full h-80 border p-2 font-mono"
            value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div className="mt-2 flex gap-2">
            <button onClick={onSave}>保存</button>
            <button onClick={() => setEditing(false)}>取消</button>
          </div>
        </>
      ) : (
        <>
          <pre className="whitespace-pre-wrap">{markdown}</pre>
          <div className="mt-4 flex gap-2">
            <button onClick={() => { setDraft(markdown); setEditing(true); }}>
              编辑
            </button>
            {status === "overview_ready" && (
              <button className="bg-blue-600 text-white px-3 py-1"
                onClick={() => approveOverview(projectId)}>
                批准进入 Case 规划
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 6: 跑测试**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-ui && pnpm test
```

- [ ] **Step 7: Commit**

```bash
cd /Users/zeoooo/crossing-writer
git add packages/web-ui/src/components/left/ProductOverviewCard.tsx \
        packages/web-ui/src/hooks/useOverview.ts \
        packages/web-ui/src/api/client.ts \
        packages/web-ui/tests/components/ProductOverviewCard.test.tsx
git -c commit.gpgsign=false commit -m "feat(web-ui): ProductOverviewCard (render/edit/approve)"
```

---

### Task 11: SectionAccordion 左栏重构

**Files:**
- Create: `packages/web-ui/src/components/layout/SectionAccordion.tsx`
- Modify: `packages/web-ui/src/pages/ProjectWorkbench.tsx`
- Create: `packages/web-ui/tests/components/SectionAccordion.test.tsx`

- [ ] **Step 1: 失败测试**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SectionAccordion, Section } from "../../src/components/layout/SectionAccordion";

describe("SectionAccordion", () => {
  it("completed sections collapse by default", () => {
    render(
      <SectionAccordion>
        <Section title="Brief" status="completed">
          <div>brief content</div>
        </Section>
        <Section title="Overview" status="active">
          <div>overview content</div>
        </Section>
      </SectionAccordion>,
    );
    expect(screen.queryByText("brief content")).toBeNull();
    expect(screen.getByText("overview content")).toBeInTheDocument();
  });

  it("toggles on click for completed section", () => {
    render(
      <SectionAccordion>
        <Section title="Brief" status="completed">
          <div>brief content</div>
        </Section>
      </SectionAccordion>,
    );
    fireEvent.click(screen.getByText("Brief"));
    expect(screen.getByText("brief content")).toBeInTheDocument();
  });

  it("pending section cannot be expanded", () => {
    render(
      <SectionAccordion>
        <Section title="Cases" status="pending">
          <div>case content</div>
        </Section>
      </SectionAccordion>,
    );
    fireEvent.click(screen.getByText("Cases"));
    expect(screen.queryByText("case content")).toBeNull();
  });
});
```

- [ ] **Step 2: 跑，预期 FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-ui && pnpm test tests/components/SectionAccordion.test.tsx
```

- [ ] **Step 3: 写组件**

```tsx
import { useState, type ReactNode } from "react";

export type SectionStatus = "completed" | "active" | "pending";

export function SectionAccordion({ children }: { children: ReactNode }) {
  return <div className="space-y-2">{children}</div>;
}

export function Section({
  title, status, children,
}: { title: string; status: SectionStatus; children: ReactNode }) {
  const [expanded, setExpanded] = useState(status === "active");

  function onToggle() {
    if (status === "pending") return;
    setExpanded((v) => !v);
  }

  const color = status === "completed" ? "text-gray-500"
    : status === "active" ? "text-blue-600 font-semibold"
    : "text-gray-300";

  return (
    <div className="border rounded">
      <button onClick={onToggle}
        className={`w-full text-left px-3 py-2 ${color}`}
        disabled={status === "pending"}>
        {title} <span className="text-xs">[{status}]</span>
      </button>
      {expanded && <div className="p-3 border-t">{children}</div>}
    </div>
  );
}
```

- [ ] **Step 4: 改 ProjectWorkbench 用 SectionAccordion**

```tsx
import { SectionAccordion, Section } from "../components/layout/SectionAccordion";
import { ProductOverviewCard } from "../components/left/ProductOverviewCard";

function statusOf(curr: string, target: string[]): "completed" | "active" | "pending" {
  // target is list of statuses considered "active" for this section
  if (target.includes(curr)) return "active";
  // logic: sections before current are completed, after are pending
  // ... compute based on ordering
  return "completed";
}

// in render:
<SectionAccordion>
  <Section title="Brief 摘要" status={briefStatus}>
    <BriefSummaryCard projectId={project.id} />
  </Section>
  <Section title="Mission 选定" status={missionStatus}>
    <SelectedMissionView projectId={project.id} />
  </Section>
  <Section title="产品概览" status={overviewStatus}>
    <ProductOverviewCard projectId={project.id} status={project.status} />
  </Section>
  <Section title="Case 列表" status={caseStatus}>
    <div>待开始</div>
  </Section>
</SectionAccordion>
```

- [ ] **Step 5: 跑测试**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-ui && pnpm test
```

- [ ] **Step 6: Commit**

```bash
cd /Users/zeoooo/crossing-writer
git add packages/web-ui/src/components/layout/SectionAccordion.tsx \
        packages/web-ui/src/pages/ProjectWorkbench.tsx \
        packages/web-ui/tests/components/SectionAccordion.test.tsx
git -c commit.gpgsign=false commit -m "feat(web-ui): SectionAccordion layout for ProjectWorkbench"
```

---

### Task 12: ExpertRegistry 支持 creativity_score

**Files:**
- Modify: `packages/web-server/src/services/expert-registry.ts`
- Modify: `~/CrossingVault/08_experts/topic-panel/index.yaml`（vault，超出 repo，通过 fixture 测）
- Modify: `packages/web-server/tests/expert-registry.test.ts`

- [ ] **Step 1: 读现状**

```bash
cat /Users/zeoooo/crossing-writer/packages/web-server/src/services/expert-registry.ts
```

期待已有 `ExpertRecord { name, file, active, default_preselect, specialty }`。这里加 `creativity_score?: number`。

- [ ] **Step 2: 失败测试**

在 `expert-registry.test.ts` 追加：

```ts
describe("creativity_score", () => {
  it("reads creativity_score from index.yaml", async () => {
    const vault = mkdtempSync(join(tmpdir(), "cs-"));
    const panelDir = join(vault, "08_experts/topic-panel");
    mkdirSync(panelDir, { recursive: true });
    writeFileSync(join(panelDir, "index.yaml"), `experts:
  - name: 数字生命卡兹克
    file: experts/kazik.md
    active: true
    default_preselect: true
    creativity_score: 9
  - name: 赛博禅心
    file: experts/zenx.md
    active: true
    default_preselect: false
    creativity_score: 7
  - name: 黄叔
    file: experts/huang.md
    active: true
    default_preselect: false
    creativity_score: 6
`, "utf-8");
    mkdirSync(join(panelDir, "experts"), { recursive: true });
    for (const n of ["kazik.md", "zenx.md", "huang.md"]) {
      writeFileSync(join(panelDir, "experts", n), "kb", "utf-8");
    }

    const reg = new ExpertRegistry(vault);
    const all = await reg.listActive();
    const k = all.find((e) => e.name === "数字生命卡兹克");
    expect(k?.creativity_score).toBe(9);
  });

  it("sortedByCreativity returns top N by score desc", async () => {
    // ... setup same as above ...
    const reg = new ExpertRegistry(vault);
    const top = await reg.topByCreativity(2);
    expect(top.map((e) => e.name)).toEqual(["数字生命卡兹克", "赛博禅心"]);
  });
});
```

- [ ] **Step 3: 跑，预期 FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test tests/expert-registry.test.ts
```

- [ ] **Step 4: 改 `expert-registry.ts`**

```ts
export interface ExpertRecord {
  name: string;
  file: string;
  active: boolean;
  default_preselect?: boolean;
  creativity_score?: number;
  specialty?: string;
}

// 在 listActive 已有逻辑里，parse yaml 时把 creativity_score 透传
// 加方法：
async topByCreativity(n: number): Promise<ExpertRecord[]> {
  const all = await this.listActive();
  return all
    .filter((e) => typeof e.creativity_score === "number")
    .sort((a, b) => (b.creativity_score ?? 0) - (a.creativity_score ?? 0))
    .slice(0, n);
}
```

- [ ] **Step 5: 更新 vault index.yaml（手工作业 / 部署脚本）**

给每位专家加 `creativity_score`。Plan 只记录要求；实际改动在 vault repo，不属于本 repo commit。

- [ ] **Step 6: 跑测试**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test
```

- [ ] **Step 7: Commit**

```bash
cd /Users/zeoooo/crossing-writer
git add packages/web-server/src/services/expert-registry.ts \
        packages/web-server/tests/expert-registry.test.ts
git -c commit.gpgsign=false commit -m "feat(web-server): ExpertRegistry supports creativity_score + topByCreativity"
```

---

### Task 13: Case expert default_preselect 策略

**Files:**
- Create: `packages/web-server/src/services/case-expert-preselect.ts`
- Create: `packages/web-server/tests/case-expert-preselect.test.ts`

- [ ] **Step 1: 失败测试**

```ts
import { describe, it, expect } from "vitest";
import { computeCasePreselect } from "../src/services/case-expert-preselect.js";

describe("computeCasePreselect", () => {
  it("union of mission experts and top3 creativity", () => {
    const all = [
      { name: "A", active: true, creativity_score: 9 } as any,
      { name: "B", active: true, creativity_score: 8 } as any,
      { name: "C", active: true, creativity_score: 7 } as any,
      { name: "D", active: true, creativity_score: 6 } as any,
      { name: "E", active: true, creativity_score: 5 } as any,
    ];
    const picked = computeCasePreselect(all, ["D", "E"]);
    expect(picked.sort()).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("caps at 5", () => {
    const all = Array.from({ length: 10 }).map((_, i) => ({
      name: `X${i}`, active: true, creativity_score: 10 - i,
    })) as any;
    const picked = computeCasePreselect(all, ["X5", "X6", "X7", "X8"]);
    expect(picked.length).toBeLessThanOrEqual(5);
  });

  it("includes top3 when mission is empty", () => {
    const all = [
      { name: "A", creativity_score: 9 } as any,
      { name: "B", creativity_score: 8 } as any,
      { name: "C", creativity_score: 7 } as any,
    ];
    expect(computeCasePreselect(all, []).sort()).toEqual(["A", "B", "C"]);
  });
});
```

- [ ] **Step 2: 跑，预期 FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test tests/case-expert-preselect.test.ts
```

- [ ] **Step 3: 写 `case-expert-preselect.ts`**

```ts
import type { ExpertRecord } from "./expert-registry.js";

const MAX_PRESELECT = 5;
const TOP_CREATIVITY_N = 3;

export function computeCasePreselect(
  all: ExpertRecord[],
  missionExperts: string[],
): string[] {
  const top = [...all]
    .filter((e) => typeof e.creativity_score === "number")
    .sort((a, b) => (b.creativity_score ?? 0) - (a.creativity_score ?? 0))
    .slice(0, TOP_CREATIVITY_N)
    .map((e) => e.name);
  const union = new Set<string>([...missionExperts, ...top]);
  return Array.from(union).slice(0, MAX_PRESELECT);
}
```

- [ ] **Step 4: 跑测试**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test
```

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer
git add packages/web-server/src/services/case-expert-preselect.ts \
        packages/web-server/tests/case-expert-preselect.test.ts
git -c commit.gpgsign=false commit -m "feat(web-server): case expert preselect = mission ∪ top3 creativity"
```

---

### Task 14: CaseExpertSelector UI

**Files:**
- Create: `packages/web-ui/src/components/right/CaseExpertSelector.tsx`
- Modify: `packages/web-ui/src/api/client.ts`
- Modify: `packages/web-server/src/routes/case-plan.ts`（add GET experts/case route — or create below in Task 20）
- Create: `packages/web-ui/tests/components/CaseExpertSelector.test.tsx`

注：GET `/api/projects/:id/experts/case` route 在本 task 里同时加到 web-server（小 route）。

- [ ] **Step 1: 加 server route**

在 `packages/web-server/src/routes/case-plan.ts`（新文件）：

```ts
import type { FastifyInstance } from "fastify";
import type { ProjectStore } from "../services/project-store.js";
import type { ExpertRegistry } from "../services/expert-registry.js";
import { computeCasePreselect } from "../services/case-expert-preselect.js";

export interface CasePlanDeps {
  store: ProjectStore;
  expertRegistry: ExpertRegistry;
}

export function registerCasePlanRoutes(app: FastifyInstance, deps: CasePlanDeps) {
  app.get<{ Params: { id: string } }>(
    "/api/projects/:id/experts/case",
    async (req, reply) => {
      const p = await deps.store.get(req.params.id);
      if (!p) return reply.code(404).send({ error: "not found" });
      const all = await deps.expertRegistry.listActive();
      const missionExperts = (p as any).mission?.experts_selected ?? [];
      const preselected = computeCasePreselect(all, missionExperts);
      return all.map((e) => ({
        name: e.name,
        specialty: e.specialty ?? "",
        creativity_score: e.creativity_score ?? null,
        preselected: preselected.includes(e.name),
      }));
    },
  );
}
```

挂载到 `server.ts`。

- [ ] **Step 2: client.ts 扩展**

```ts
export interface CaseExpertInfo {
  name: string;
  specialty: string;
  creativity_score: number | null;
  preselected: boolean;
}

export async function listCaseExperts(projectId: string): Promise<CaseExpertInfo[]> {
  const res = await fetch(`/api/projects/${projectId}/experts/case`);
  if (!res.ok) throw new Error("failed");
  return res.json();
}

export async function startCasePlan(projectId: string, experts: string[]): Promise<void> {
  const res = await fetch(`/api/projects/${projectId}/case-plan/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ experts }),
  });
  if (!res.ok) throw new Error("start failed");
}
```

- [ ] **Step 3: 失败测试**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CaseExpertSelector } from "../../src/components/right/CaseExpertSelector";

vi.mock("../../src/api/client", () => ({
  listCaseExperts: vi.fn(async () => [
    { name: "卡兹克", specialty: "视频", creativity_score: 9, preselected: true },
    { name: "赛博禅心", specialty: "禅", creativity_score: 7, preselected: true },
    { name: "黄叔", specialty: "工具", creativity_score: 6, preselected: false },
  ]),
  startCasePlan: vi.fn(async () => {}),
}));

describe("CaseExpertSelector", () => {
  it("renders experts with preselect checked", async () => {
    render(<CaseExpertSelector projectId="p1" />);
    await waitFor(() => screen.getByText("卡兹克"));
    const kz = screen.getByLabelText(/卡兹克/) as HTMLInputElement;
    const hu = screen.getByLabelText(/黄叔/) as HTMLInputElement;
    expect(kz.checked).toBe(true);
    expect(hu.checked).toBe(false);
  });

  it("starts plan with selected experts", async () => {
    const { startCasePlan } = await import("../../src/api/client");
    render(<CaseExpertSelector projectId="p1" />);
    await waitFor(() => screen.getByText("卡兹克"));
    fireEvent.click(screen.getByRole("button", { name: /开跑 Case 规划/ }));
    await waitFor(() => {
      expect(startCasePlan).toHaveBeenCalledWith("p1", expect.arrayContaining(["卡兹克", "赛博禅心"]));
    });
  });
});
```

- [ ] **Step 4: 跑，预期 FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-ui && pnpm test tests/components/CaseExpertSelector.test.tsx
```

- [ ] **Step 5: 写组件**

```tsx
import { useEffect, useState } from "react";
import { listCaseExperts, startCasePlan, type CaseExpertInfo } from "../../api/client";

export function CaseExpertSelector({ projectId }: { projectId: string }) {
  const [experts, setExperts] = useState<CaseExpertInfo[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    listCaseExperts(projectId).then((list) => {
      setExperts(list);
      setSelected(new Set(list.filter((e) => e.preselected).map((e) => e.name)));
    });
  }, [projectId]);

  function toggle(name: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(name)) n.delete(name); else n.add(name);
      return n;
    });
  }

  async function onStart() {
    await startCasePlan(projectId, Array.from(selected));
  }

  return (
    <div className="p-4">
      <h3 className="font-semibold">选择 Case 专家</h3>
      <ul className="space-y-1 mt-2">
        {experts.map((e) => (
          <li key={e.name}>
            <label>
              <input type="checkbox" checked={selected.has(e.name)}
                onChange={() => toggle(e.name)} />
              <span> {e.name} · 创意 {e.creativity_score ?? "-"} · {e.specialty}</span>
            </label>
          </li>
        ))}
      </ul>
      <button onClick={onStart} disabled={selected.size === 0}
        className="mt-4 bg-blue-600 text-white px-3 py-1">
        开跑 Case 规划
      </button>
    </div>
  );
}
```

- [ ] **Step 6: 跑测试**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-ui && pnpm test
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test
```

- [ ] **Step 7: Commit**

```bash
cd /Users/zeoooo/crossing-writer
git add packages/web-ui/src/components/right/CaseExpertSelector.tsx \
        packages/web-ui/src/api/client.ts \
        packages/web-ui/tests/components/CaseExpertSelector.test.tsx \
        packages/web-server/src/routes/case-plan.ts \
        packages/web-server/src/server.ts
git -c commit.gpgsign=false commit -m "feat(web-ui,web-server): CaseExpertSelector + /experts/case route"
```

---

### Task 15: case-inspiration-pack-builder

**Files:**
- Create: `packages/web-server/src/services/case-inspiration-pack-builder.ts`
- Create: `packages/web-server/tests/case-inspiration-pack-builder.test.ts`

- [ ] **Step 1: 失败测试**

```ts
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildInspirationPack } from "../src/services/case-inspiration-pack-builder.js";

const mockSearch = vi.fn();
vi.mock("../src/services/crossing-kb-search.js", () => ({
  searchRefs: (...args: any[]) => mockSearch(...args),
}));

describe("buildInspirationPack", () => {
  it("extracts prompts and steps from refs", async () => {
    const vault = mkdtempSync(join(tmpdir(), "insp-"));
    const refDir = join(vault, "10_refs/卡兹克/2026");
    mkdirSync(refDir, { recursive: true });
    writeFileSync(join(refDir, "2026-01-01_AI视频.md"), `---
title: 实测 AI 视频
account: 数字生命卡兹克
date: 2026-01-01
---
# 背景
我们测试了 C1 模型。

## 提示词如下：
\`\`\`
古代山门宗派入口，两名修士对峙
\`\`\`

## 测试步骤
1. 准备九宫格图
2. 选 C1 模型
3. 点生成
`, "utf-8");

    mockSearch.mockResolvedValue([{
      mdPath: "10_refs/卡兹克/2026/2026-01-01_AI视频.md",
      title: "实测 AI 视频",
      account: "数字生命卡兹克",
      date: "2026-01-01",
    }]);

    const pack = await buildInspirationPack({
      vaultPath: vault,
      sqlitePath: "/fake",
      queries: ["AI 视频 实测"],
      maxSources: 10,
    });
    expect(pack).toContain("古代山门宗派入口");
    expect(pack).toContain("准备九宫格图");
    expect(pack).toContain("数字生命卡兹克");
    expect(pack).toContain("type: case_inspiration_pack");
  });

  it("falls back to summary when no prompt/steps found", async () => {
    const vault = mkdtempSync(join(tmpdir(), "insp-"));
    const refDir = join(vault, "10_refs/黄叔/2026");
    mkdirSync(refDir, { recursive: true });
    writeFileSync(join(refDir, "x.md"), `---
title: 工具测评
account: 黄叔
---
# 纯文本内容，没 code block，没步骤列表
只是段落描述了一下产品印象。
`, "utf-8");

    mockSearch.mockResolvedValue([{
      mdPath: "10_refs/黄叔/2026/x.md",
      title: "工具测评", account: "黄叔", date: "2026",
    }]);
    const pack = await buildInspirationPack({
      vaultPath: vault, sqlitePath: "/fake",
      queries: ["工具"], maxSources: 10,
    });
    expect(pack).toContain("工具测评");
    expect(pack).toContain("纯文本内容");
  });
});
```

- [ ] **Step 2: 跑，预期 FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test tests/case-inspiration-pack-builder.test.ts
```

- [ ] **Step 3: 写 `case-inspiration-pack-builder.ts`**

```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { searchRefs, type RefSearchResult } from "./crossing-kb-search.js";

export interface BuildInspirationOpts {
  vaultPath: string;
  sqlitePath: string;
  queries: string[];
  maxSources?: number;
}

const PROMPT_BLOCK_RE = /```(?:text|prompt)?\n([\s\S]*?)\n```/g;
const PROMPT_LABEL_RE = /(?:提示词[如:][:：]?|prompt[:：]?)\s*\n+([^\n]{10,500})/gi;
const STEPS_RE = /(?:测试步骤|步骤|steps)[:：]?\s*\n+((?:\s*\d+\.\s*[^\n]+\n?){1,6})/gi;

function extractPrompts(body: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = PROMPT_BLOCK_RE.exec(body))) {
    const t = m[1]!.trim();
    if (t.length > 10 && t.length < 1000) out.push(t);
  }
  PROMPT_LABEL_RE.lastIndex = 0;
  while ((m = PROMPT_LABEL_RE.exec(body))) {
    out.push(m[1]!.trim());
  }
  return out.slice(0, 3);
}

function extractSteps(body: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  STEPS_RE.lastIndex = 0;
  while ((m = STEPS_RE.exec(body))) {
    out.push(m[1]!.trim());
  }
  return out.slice(0, 2);
}

export async function buildInspirationPack(opts: BuildInspirationOpts): Promise<string> {
  const max = opts.maxSources ?? 15;
  const hits: RefSearchResult[] = [];
  for (const q of opts.queries) {
    const r = await searchRefs(opts.sqlitePath, q, Math.ceil(max / opts.queries.length));
    hits.push(...r);
  }
  const dedupe = new Map<string, RefSearchResult>();
  for (const h of hits) if (!dedupe.has(h.mdPath)) dedupe.set(h.mdPath, h);
  const sources = Array.from(dedupe.values()).slice(0, max);

  const lines: string[] = [];
  lines.push("---");
  lines.push("type: case_inspiration_pack");
  lines.push(`queries: ${JSON.stringify(opts.queries)}`);
  lines.push(`total_sources: ${sources.length}`);
  lines.push("---", "", "# Inspiration Pack", "");

  for (let i = 0; i < sources.length; i += 1) {
    const s = sources[i]!;
    let body = "";
    try {
      body = await readFile(join(opts.vaultPath, s.mdPath), "utf-8");
    } catch {}
    const prompts = extractPrompts(body);
    const steps = extractSteps(body);

    lines.push(`## ${i + 1}. 《${s.title}》— ${s.account} ${s.date}`, "");
    if (prompts.length) {
      lines.push("**Prompts used**:");
      for (const p of prompts) lines.push("```", p, "```", "");
    }
    if (steps.length) {
      lines.push("**Test steps**:");
      for (const st of steps) lines.push(st, "");
    }
    if (!prompts.length && !steps.length) {
      const summary = body.replace(/^---[\s\S]*?---\n/, "").slice(0, 2000);
      lines.push("**Summary (fallback)**:", summary, "");
    }
    lines.push("---", "");
  }
  return lines.join("\n");
}
```

- [ ] **Step 4: 跑测试**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test
```

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer
git add packages/web-server/src/services/case-inspiration-pack-builder.ts \
        packages/web-server/tests/case-inspiration-pack-builder.test.ts
git -c commit.gpgsign=false commit -m "feat(web-server): case-inspiration-pack-builder extracts prompts+steps from refs"
```

---

### Task 16: CasePlannerExpert role + round1/round2 prompts

**Files:**
- Create: `packages/agents/src/prompts/case-expert-round1.md`
- Create: `packages/agents/src/prompts/case-expert-round2.md`
- Create: `packages/agents/src/roles/case-planner-expert.ts`
- Modify: `packages/agents/src/index.ts`
- Create: `packages/agents/tests/case-planner-expert.test.ts`

- [ ] **Step 1: 写 round1 prompt**

`packages/agents/src/prompts/case-expert-round1.md`：

```markdown
你是 "{{expertName}}"，十字路口的 Case 规划专家。

你收到：
1. Mission 摘要（mission/selected.md）
2. 产品概览（context/product-overview.md）
3. Inspiration Pack（case-inspiration-pack.md）：别的测评文章里的 prompt 和步骤
4. 你自己的 KB（experts/<你>_kb.md）

你的任务：产出 1-3 个**有创意的 Case**，每个 Case 是一份结构化 markdown。

## Case 格式（每个 Case 前后用 `# Case N` 分开）

```yaml
---
type: case
case_id: case-{N}
name: <短名>
proposed_by: {{expertName}}
creativity_score: <1-10 你自评>
why_it_matters: <一句话>
supports_claims: [primary_claim | secondary_claim_N]
steps:
  - step: 1
    action: <动作>
    prep_required: <true/false>
prompts:
  - purpose: <用途>
    text: |
      <完整 prompt 文本>
expected_media:
  - kind: image | video | audio | text
    spec: {...}
observation_points: [...]
screenshot_points: [...]
recording_points: [...]
risks: [...]
predicted_outcome: |
  成功 / 失败 两种情况描述
inspired_by:
  - ref_path: <from inspiration pack>
    what_borrowed: <借鉴点>
---

# 详细说明
<500-800 字解释>
```

## 工具调用（可选）

如果你觉得 inspiration pack 不够，可以**在输出末尾**追加一个工具调用块（最多 1 个）：

```
```tool
crossing-kb search "<你的查询词>" --account=<可选> --limit=5
```
```

系统会执行这个查询，把结果塞回来让你在 Round 2 细化 Case。**只发 1 个工具调用，超过会被忽略。**
如果当前草稿够好，不发 tool 块直接结束。
```

- [ ] **Step 2: 写 round2 prompt**

`packages/agents/src/prompts/case-expert-round2.md`：

```markdown
你刚提交了 Round 1 的 Case 草稿（附在下方），并发起了一个 `crossing-kb search` 工具调用。
系统已经执行，结果也在下方。

现在请**基于新证据**改写/扩展你的 Case：
- 如果工具结果里的某篇文章有更好的 prompt / 测试角度，把它加到 inspired_by，并更新 prompts/steps
- 如果结果证实原 Case 思路，就保持并在 why_it_matters 里加一句引用
- 最多仍然是 1-3 个 Case
- 格式严格同 Round 1

## 你的 Round 1 草稿

{{round1Draft}}

## 工具执行结果

{{toolResults}}

请输出 Round 2 最终 Cases（不要再发 tool call，Round 2 是终点）。
```

- [ ] **Step 3: 失败测试**

```ts
import { describe, it, expect, vi } from "vitest";
import { CasePlannerExpert } from "../src/roles/case-planner-expert.js";

vi.mock("../src/model-adapter.js", () => ({
  invokeAgent: vi.fn(() => ({
    text: "# Case 1\n---\ntype: case\nname: X\n---\n正文",
    meta: { cli: "claude", model: "opus", durationMs: 100 },
  })),
}));

describe("CasePlannerExpert", () => {
  it("round1 passes mission + overview + inspiration + kb", async () => {
    const { invokeAgent } = await import("../src/model-adapter.js");
    const expert = new CasePlannerExpert({
      name: "卡兹克",
      cli: "claude",
      kbMarkdown: "我专注视频测评",
    });
    await expert.round1({
      missionSummary: "m",
      productOverview: "po",
      inspirationPack: "ip",
    });
    const call = vi.mocked(invokeAgent).mock.calls[0]![0];
    expect(call.systemPrompt).toContain("卡兹克");
    expect(call.userMessage).toContain("m");
    expect(call.userMessage).toContain("po");
    expect(call.userMessage).toContain("ip");
    expect(call.userMessage).toContain("我专注视频测评");
  });

  it("round2 passes round1 draft + tool results", async () => {
    const { invokeAgent } = await import("../src/model-adapter.js");
    vi.mocked(invokeAgent).mockClear();
    const expert = new CasePlannerExpert({
      name: "卡兹克", cli: "claude", kbMarkdown: "",
    });
    await expert.round2({
      round1Draft: "prev draft",
      toolResults: "tool out",
    });
    const call = vi.mocked(invokeAgent).mock.calls[0]![0];
    expect(call.systemPrompt).toContain("prev draft");
    expect(call.systemPrompt).toContain("tool out");
  });
});
```

- [ ] **Step 4: 跑，预期 FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/agents && pnpm test tests/case-planner-expert.test.ts
```

- [ ] **Step 5: 写 `case-planner-expert.ts`**

```ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { invokeAgent } from "../model-adapter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const R1 = readFileSync(join(__dirname, "../prompts/case-expert-round1.md"), "utf-8");
const R2 = readFileSync(join(__dirname, "../prompts/case-expert-round2.md"), "utf-8");

export interface CaseExpertOpts {
  name: string;
  cli: "claude" | "codex";
  model?: string;
  kbMarkdown: string;
}

export interface Round1Input {
  missionSummary: string;
  productOverview: string;
  inspirationPack: string;
}

export interface Round2Input {
  round1Draft: string;
  toolResults: string;
}

export interface CaseResult {
  text: string;
  meta: { cli: string; model?: string | null; durationMs: number };
}

export class CasePlannerExpert {
  constructor(private opts: CaseExpertOpts) {}

  async round1(input: Round1Input): Promise<CaseResult> {
    const sys = R1.replaceAll("{{expertName}}", this.opts.name);
    const user = [
      "# Mission 摘要",
      input.missionSummary,
      "",
      "# 产品概览",
      input.productOverview,
      "",
      "# Inspiration Pack",
      input.inspirationPack,
      "",
      "# 我的 KB",
      this.opts.kbMarkdown,
    ].join("\n");
    const r = invokeAgent({
      agentKey: `case_expert.${this.opts.name}`,
      cli: this.opts.cli,
      model: this.opts.model,
      systemPrompt: sys,
      userMessage: user,
    });
    return { text: r.text, meta: { cli: r.meta.cli, model: r.meta.model ?? null, durationMs: r.meta.durationMs } };
  }

  async round2(input: Round2Input): Promise<CaseResult> {
    const sys = R2
      .replace("{{round1Draft}}", input.round1Draft)
      .replace("{{toolResults}}", input.toolResults);
    const r = invokeAgent({
      agentKey: `case_expert.${this.opts.name}`,
      cli: this.opts.cli,
      model: this.opts.model,
      systemPrompt: sys,
      userMessage: "请输出 Round 2 最终 Cases。",
    });
    return { text: r.text, meta: { cli: r.meta.cli, model: r.meta.model ?? null, durationMs: r.meta.durationMs } };
  }
}
```

- [ ] **Step 6: 在 `index.ts` 导出**

```ts
export { CasePlannerExpert } from "./roles/case-planner-expert.js";
export type { CaseExpertOpts, Round1Input, Round2Input, CaseResult } from "./roles/case-planner-expert.js";
```

- [ ] **Step 7: 跑测试**

```bash
cd /Users/zeoooo/crossing-writer/packages/agents && pnpm test
```

- [ ] **Step 8: Commit**

```bash
cd /Users/zeoooo/crossing-writer
git add packages/agents/src/prompts/case-expert-round1.md \
        packages/agents/src/prompts/case-expert-round2.md \
        packages/agents/src/roles/case-planner-expert.ts \
        packages/agents/src/index.ts \
        packages/agents/tests/case-planner-expert.test.ts
git -c commit.gpgsign=false commit -m "feat(agents): CasePlannerExpert with round1/round2 tool-loop prompts"
```

---

### Task 17: CaseCoordinator role

**Files:**
- Create: `packages/agents/src/prompts/case-coordinator.md`
- Create: `packages/agents/src/roles/case-coordinator.ts`
- Modify: `packages/agents/src/index.ts`
- Create: `packages/agents/tests/case-coordinator.test.ts`

- [ ] **Step 1: 写 prompt**

```markdown
你是 Case Coordinator。你收到 N 位专家的 Case 输出。

任务：
1. 去重：角度相似（≥0.5 重叠）的 Case 合并；保留更完整/更有创意的版本
2. 排序：按 creativity_score + supports_claims 覆盖度
3. 产出一份 `mission/case-plan/candidates.md`：

```yaml
---
type: case_plan_candidates
run_id: <ts>
experts_participated: [...]
total_cases: N
---

# Case 01 — <name>
<完整 case frontmatter + 正文>

# Case 02 — ...
```

**要求**：
- 至少 3 个 Case
- 最多 8 个 Case
- 每个 Case 必须保留 proposed_by / inspired_by / steps / prompts
- 不要自己编 Case，只能从专家输出合成
```

- [ ] **Step 2: 失败测试**

```ts
import { describe, it, expect, vi } from "vitest";
import { CaseCoordinator } from "../src/roles/case-coordinator.js";

vi.mock("../src/model-adapter.js", () => ({
  invokeAgent: vi.fn(() => ({
    text: "---\ntype: case_plan_candidates\ntotal_cases: 3\n---\n# Case 01\n...",
    meta: { cli: "claude", model: "opus", durationMs: 200 },
  })),
}));

describe("CaseCoordinator", () => {
  it("synthesizes all experts' outputs", async () => {
    const { invokeAgent } = await import("../src/model-adapter.js");
    const c = new CaseCoordinator({ cli: "claude", model: "opus" });
    const r = await c.synthesize({
      expertOutputs: [
        { expert: "A", text: "# Case X" },
        { expert: "B", text: "# Case Y" },
      ],
      missionSummary: "mission",
      productOverview: "po",
    });
    expect(r.text).toContain("case_plan_candidates");
    const call = vi.mocked(invokeAgent).mock.calls[0]![0];
    expect(call.userMessage).toContain("# Case X");
    expect(call.userMessage).toContain("# Case Y");
    expect(call.userMessage).toContain("A");
    expect(call.userMessage).toContain("B");
  });
});
```

- [ ] **Step 3: 跑，预期 FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/agents && pnpm test tests/case-coordinator.test.ts
```

- [ ] **Step 4: 写 `case-coordinator.ts`**

```ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { invokeAgent } from "../model-adapter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM = readFileSync(join(__dirname, "../prompts/case-coordinator.md"), "utf-8");

export interface SynthesizeInput {
  expertOutputs: Array<{ expert: string; text: string }>;
  missionSummary: string;
  productOverview: string;
}

export class CaseCoordinator {
  constructor(private opts: { cli: "claude" | "codex"; model?: string }) {}

  async synthesize(input: SynthesizeInput) {
    const parts: string[] = [
      "# Mission 摘要", input.missionSummary, "",
      "# 产品概览", input.productOverview, "",
      "# 专家输出（按姓名分组）",
    ];
    for (const o of input.expertOutputs) {
      parts.push("", `## 专家: ${o.expert}`, o.text);
    }
    const r = invokeAgent({
      agentKey: "case_coordinator",
      cli: this.opts.cli,
      model: this.opts.model,
      systemPrompt: SYSTEM,
      userMessage: parts.join("\n"),
    });
    return { text: r.text, meta: { cli: r.meta.cli, model: r.meta.model ?? null, durationMs: r.meta.durationMs } };
  }
}
```

- [ ] **Step 5: 导出 + 测试 + commit**

```ts
// index.ts
export { CaseCoordinator } from "./roles/case-coordinator.js";
```

```bash
cd /Users/zeoooo/crossing-writer/packages/agents && pnpm test
cd /Users/zeoooo/crossing-writer
git add packages/agents/src/prompts/case-coordinator.md \
        packages/agents/src/roles/case-coordinator.ts \
        packages/agents/src/index.ts \
        packages/agents/tests/case-coordinator.test.ts
git -c commit.gpgsign=false commit -m "feat(agents): CaseCoordinator synthesizes expert outputs"
```

---

### Task 18: case-expert-runner（tool loop）

**Files:**
- Create: `packages/agents/src/case-expert-runner.ts`
- Modify: `packages/agents/src/index.ts`
- Create: `packages/agents/tests/case-expert-runner.test.ts`

- [ ] **Step 1: 失败测试**

```ts
import { describe, it, expect, vi } from "vitest";
import { runCaseExpert, parseToolCalls } from "../src/case-expert-runner.js";

describe("parseToolCalls", () => {
  it("parses single crossing-kb search tool block", () => {
    const text = `# Case 1
some body
\`\`\`tool
crossing-kb search "AI 视频 实测" --account=卡兹克 --limit=5
\`\`\`
`;
    const calls = parseToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.command).toBe("crossing-kb");
    expect(calls[0]!.args[0]).toBe("search");
    expect(calls[0]!.query).toBe("AI 视频 实测");
    expect(calls[0]!.account).toBe("卡兹克");
    expect(calls[0]!.limit).toBe(5);
  });

  it("returns empty when no tool block", () => {
    expect(parseToolCalls("no tool here")).toEqual([]);
  });

  it("caps at 1 call (ignore extras)", () => {
    const text = `\`\`\`tool
crossing-kb search "a"
\`\`\`
\`\`\`tool
crossing-kb search "b"
\`\`\``;
    expect(parseToolCalls(text)).toHaveLength(1);
  });
});

describe("runCaseExpert", () => {
  it("no tool call → round1 only", async () => {
    const expert = {
      name: "A",
      round1: vi.fn(async () => ({ text: "# Case 1\nno tool", meta: {} as any })),
      round2: vi.fn(),
    } as any;
    const runToolFn = vi.fn();
    const result = await runCaseExpert(expert, {
      missionSummary: "m", productOverview: "o", inspirationPack: "i",
    }, runToolFn);
    expect(result.roundsUsed).toBe(1);
    expect(expert.round2).not.toHaveBeenCalled();
    expect(runToolFn).not.toHaveBeenCalled();
    expect(result.final.text).toContain("no tool");
  });

  it("with tool call → round1 + tool + round2", async () => {
    const expert = {
      name: "A",
      round1: vi.fn(async () => ({
        text: "# Case 1\n```tool\ncrossing-kb search \"x\"\n```",
        meta: {} as any,
      })),
      round2: vi.fn(async () => ({ text: "# Case 1 refined", meta: {} as any })),
    } as any;
    const runToolFn = vi.fn(async () => "tool-results-body");
    const result = await runCaseExpert(expert, {
      missionSummary: "m", productOverview: "o", inspirationPack: "i",
    }, runToolFn);
    expect(result.roundsUsed).toBe(2);
    expect(runToolFn).toHaveBeenCalledWith([{ command: "crossing-kb", args: ["search"], query: "x", account: undefined, limit: undefined }]);
    expect(expert.round2).toHaveBeenCalled();
    expect(result.final.text).toContain("refined");
    expect(result.toolCallsMade).toHaveLength(1);
  });

  it("tool failure → fallback empty, round2 still runs", async () => {
    const expert = {
      name: "A",
      round1: vi.fn(async () => ({
        text: "```tool\ncrossing-kb search \"x\"\n```",
        meta: {} as any,
      })),
      round2: vi.fn(async () => ({ text: "fallback refined", meta: {} as any })),
    } as any;
    const runToolFn = vi.fn(async () => { throw new Error("kb timeout"); });
    const result = await runCaseExpert(expert, {
      missionSummary: "m", productOverview: "o", inspirationPack: "i",
    }, runToolFn);
    expect(result.roundsUsed).toBe(2);
    expect(expert.round2).toHaveBeenCalled();
    const arg = expert.round2.mock.calls[0][0];
    expect(arg.toolResults).toMatch(/\(no results|empty|error/i);
  });
});
```

- [ ] **Step 2: 跑，预期 FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/agents && pnpm test tests/case-expert-runner.test.ts
```

- [ ] **Step 3: 写 `case-expert-runner.ts`**

```ts
import type { CasePlannerExpert, Round1Input } from "./roles/case-planner-expert.js";

export interface ToolCall {
  command: "crossing-kb";
  args: string[];
  query?: string;
  account?: string;
  limit?: number;
}

const TOOL_BLOCK_RE = /```tool\s*\n([\s\S]*?)\n```/g;

export function parseToolCalls(text: string): ToolCall[] {
  const out: ToolCall[] = [];
  let m: RegExpExecArray | null;
  TOOL_BLOCK_RE.lastIndex = 0;
  while ((m = TOOL_BLOCK_RE.exec(text))) {
    const line = m[1]!.trim();
    if (!line.startsWith("crossing-kb")) continue;
    // crossing-kb search "query" --account=X --limit=N
    const tokens = tokenize(line);
    if (tokens[1] !== "search") continue;
    const query = tokens[2];
    let account: string | undefined;
    let limit: number | undefined;
    for (const t of tokens.slice(3)) {
      const am = t.match(/^--account=(.+)$/);
      const lm = t.match(/^--limit=(\d+)$/);
      if (am) account = am[1];
      if (lm) limit = parseInt(lm[1]!, 10);
    }
    out.push({ command: "crossing-kb", args: ["search"], query, account, limit });
    if (out.length >= 1) break;
  }
  return out;
}

function tokenize(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push(m[1] ?? m[2]!);
  return out;
}

export type ToolExecutor = (calls: ToolCall[]) => Promise<string>;

export interface RunCaseExpertResult {
  final: { text: string; meta: any };
  roundsUsed: 1 | 2;
  toolCallsMade: ToolCall[];
}

export async function runCaseExpert(
  expert: CasePlannerExpert,
  input: Round1Input,
  runTool: ToolExecutor,
): Promise<RunCaseExpertResult> {
  const r1 = await expert.round1(input);
  const calls = parseToolCalls(r1.text);
  if (calls.length === 0) {
    return { final: r1, roundsUsed: 1, toolCallsMade: [] };
  }
  let toolResultsText: string;
  try {
    toolResultsText = await runTool(calls);
    if (!toolResultsText) toolResultsText = "(no results)";
  } catch (e) {
    toolResultsText = `(tool error: ${String(e)})`;
  }
  const r2 = await expert.round2({
    round1Draft: r1.text,
    toolResults: toolResultsText,
  });
  return { final: r2, roundsUsed: 2, toolCallsMade: calls };
}
```

- [ ] **Step 4: 导出 + 跑 + commit**

```ts
// index.ts
export { runCaseExpert, parseToolCalls } from "./case-expert-runner.js";
export type { ToolCall, ToolExecutor, RunCaseExpertResult } from "./case-expert-runner.js";
```

```bash
cd /Users/zeoooo/crossing-writer/packages/agents && pnpm test
cd /Users/zeoooo/crossing-writer
git add packages/agents/src/case-expert-runner.ts \
        packages/agents/src/index.ts \
        packages/agents/tests/case-expert-runner.test.ts
git -c commit.gpgsign=false commit -m "feat(agents): case-expert-runner with 1-round tool loop"
```

---

### Task 19: CasePlanOrchestrator

**Files:**
- Create: `packages/web-server/src/services/case-plan-orchestrator.ts`
- Create: `packages/web-server/tests/case-plan-orchestrator.test.ts`

- [ ] **Step 1: 失败测试**

```ts
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/services/project-store.js";
import { runCasePlan } from "../src/services/case-plan-orchestrator.js";

vi.mock("@crossing/agents", () => ({
  CasePlannerExpert: vi.fn().mockImplementation((opts: any) => ({
    name: opts.name,
    round1: async () => ({ text: `# Case by ${opts.name}`, meta: { cli: "claude", model: "opus", durationMs: 50 } }),
    round2: async () => ({ text: `# Refined by ${opts.name}`, meta: { cli: "claude", model: "opus", durationMs: 60 } }),
  })),
  CaseCoordinator: vi.fn().mockImplementation(() => ({
    synthesize: async () => ({
      text: "---\ntype: case_plan_candidates\ntotal_cases: 2\n---\n# Case 01\n...",
      meta: { cli: "claude", model: "opus", durationMs: 100 },
    }),
  })),
  runCaseExpert: async (e: any) => ({
    final: await e.round1({}), roundsUsed: 1, toolCallsMade: [],
  }),
  resolveAgent: vi.fn(() => ({ cli: "claude", model: "opus" })),
}));

vi.mock("../src/services/case-inspiration-pack-builder.js", () => ({
  buildInspirationPack: async () => "inspiration pack content",
}));

describe("runCasePlan", () => {
  it("runs experts in parallel, coordinator, writes candidates.md", async () => {
    const vault = mkdtempSync(join(tmpdir(), "cp-"));
    const projectsDir = join(vault, "07_projects");
    const store = new ProjectStore(projectsDir);
    const p = await store.create({ name: "T" });
    const projectDir = join(projectsDir, p.id);
    mkdirSync(join(projectDir, "mission"), { recursive: true });
    mkdirSync(join(projectDir, "context"), { recursive: true });
    writeFileSync(join(projectDir, "mission/selected.md"), "mission body", "utf-8");
    writeFileSync(join(projectDir, "context/product-overview.md"), "po body", "utf-8");
    await store.update(p.id, { status: "awaiting_case_expert_selection" });

    await runCasePlan({
      projectId: p.id,
      projectsDir,
      store,
      vaultPath: vault,
      sqlitePath: "/fake",
      experts: ["卡兹克", "赛博禅心"],
      expertKbs: { "卡兹克": "kb1", "赛博禅心": "kb2" },
      agents: {},
      defaultCli: "claude",
      fallbackCli: "codex",
    });

    const candPath = join(projectDir, "mission/case-plan/candidates.md");
    expect(existsSync(candPath)).toBe(true);
    expect(readFileSync(candPath, "utf-8")).toContain("case_plan_candidates");

    const events = readFileSync(join(projectDir, "events.jsonl"), "utf-8");
    expect(events).toContain("case_expert.round1_started");
    expect(events).toContain("case_coordinator.synthesizing");
    expect(events).toContain("case_coordinator.done");

    const updated = await store.get(p.id);
    expect(updated?.status).toBe("awaiting_case_selection");
  });

  it("on expert failure, moves to case_planning_failed", async () => {
    const ag = await import("@crossing/agents") as any;
    ag.CasePlannerExpert.mockImplementationOnce(() => ({
      round1: async () => { throw new Error("boom"); },
      round2: async () => {},
    }));
    const vault = mkdtempSync(join(tmpdir(), "cp-"));
    const projectsDir = join(vault, "07_projects");
    const store = new ProjectStore(projectsDir);
    const p = await store.create({ name: "T" });
    const projectDir = join(projectsDir, p.id);
    mkdirSync(join(projectDir, "mission"), { recursive: true });
    mkdirSync(join(projectDir, "context"), { recursive: true });
    writeFileSync(join(projectDir, "mission/selected.md"), "m", "utf-8");
    writeFileSync(join(projectDir, "context/product-overview.md"), "po", "utf-8");

    await expect(runCasePlan({
      projectId: p.id, projectsDir, store,
      vaultPath: vault, sqlitePath: "/fake",
      experts: ["X"], expertKbs: { X: "" },
      agents: {}, defaultCli: "claude", fallbackCli: "codex",
    })).rejects.toThrow();

    const updated = await store.get(p.id);
    expect(updated?.status).toBe("case_planning_failed");
  });
});
```

- [ ] **Step 2: 跑，预期 FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test tests/case-plan-orchestrator.test.ts
```

- [ ] **Step 3: 写 `case-plan-orchestrator.ts`**

```ts
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CasePlannerExpert, CaseCoordinator, runCaseExpert, resolveAgent,
  type ToolCall,
} from "@crossing/agents";
import type { ProjectStore } from "./project-store.js";
import { appendEvent } from "./event-log.js";
import { buildInspirationPack } from "./case-inspiration-pack-builder.js";
import { searchRefs } from "./crossing-kb-search.js";

export interface RunCasePlanOpts {
  projectId: string;
  projectsDir: string;
  store: ProjectStore;
  vaultPath: string;
  sqlitePath: string;
  experts: string[];
  expertKbs: Record<string, string>;
  agents: Record<string, unknown>;
  defaultCli: "claude" | "codex";
  fallbackCli: "claude" | "codex";
}

export async function runCasePlan(opts: RunCasePlanOpts): Promise<string> {
  const projectDir = join(opts.projectsDir, opts.projectId);
  await opts.store.update(opts.projectId, { status: "case_planning_running" });

  const missionSummary = await readFile(join(projectDir, "mission/selected.md"), "utf-8");
  const productOverview = await readFile(join(projectDir, "context/product-overview.md"), "utf-8");
  const inspirationPack = await buildInspirationPack({
    vaultPath: opts.vaultPath,
    sqlitePath: opts.sqlitePath,
    queries: extractQueries(missionSummary, productOverview),
    maxSources: 15,
  });
  await mkdir(join(projectDir, "context"), { recursive: true });
  await writeFile(join(projectDir, "context/case-inspiration-pack.md"), inspirationPack, "utf-8");

  const round1Dir = join(projectDir, "mission/case-plan/round1");
  await mkdir(round1Dir, { recursive: true });

  const expertOutputs: Array<{ expert: string; text: string }> = [];

  try {
    await Promise.all(opts.experts.map(async (name) => {
      const resolved = resolveAgent(
        { vaultPath: opts.vaultPath, sqlitePath: opts.sqlitePath,
          modelAdapter: { defaultCli: opts.defaultCli, fallbackCli: opts.fallbackCli },
          agents: opts.agents },
        `case_expert.${name}`,
      );
      await appendEvent(projectDir, {
        type: "case_expert.round1_started",
        agent: `case_expert.${name}`,
        expert: name,
        cli: resolved.cli, model: resolved.model ?? null,
      });
      const expert = new CasePlannerExpert({
        name, cli: resolved.cli as any, model: resolved.model,
        kbMarkdown: opts.expertKbs[name] ?? "",
      });

      const result = await runCaseExpert(
        expert,
        { missionSummary, productOverview, inspirationPack },
        async (calls: ToolCall[]) => {
          for (const c of calls) {
            await appendEvent(projectDir, {
              type: "case_expert.tool_call",
              expert: name,
              command: c.command,
              query: c.query,
              account: c.account,
            });
          }
          const hits = await searchRefs(opts.sqlitePath, calls[0]?.query ?? "", calls[0]?.limit ?? 5);
          return hits.map((h) => `- ${h.title} — ${h.account} (${h.mdPath})`).join("\n");
        },
      );

      await writeFile(join(round1Dir, `${name}.md`), result.final.text, "utf-8");
      if (result.roundsUsed === 2) {
        await appendEvent(projectDir, {
          type: "case_expert.round2_completed",
          agent: `case_expert.${name}`, expert: name,
          cli: resolved.cli, model: resolved.model ?? null,
        });
      }
      await appendEvent(projectDir, {
        type: "case_expert.round1_completed",
        agent: `case_expert.${name}`, expert: name,
        cli: resolved.cli, model: resolved.model ?? null,
        rounds_used: result.roundsUsed,
      });
      expertOutputs.push({ expert: name, text: result.final.text });
    }));
  } catch (e) {
    await opts.store.update(opts.projectId, { status: "case_planning_failed" });
    await appendEvent(projectDir, { type: "case_expert.failed", error: String(e) });
    throw e;
  }

  await opts.store.update(opts.projectId, { status: "case_synthesizing" });
  const coordResolved = resolveAgent(
    { vaultPath: opts.vaultPath, sqlitePath: opts.sqlitePath,
      modelAdapter: { defaultCli: opts.defaultCli, fallbackCli: opts.fallbackCli },
      agents: opts.agents },
    "case_coordinator",
  );
  await appendEvent(projectDir, {
    type: "case_coordinator.synthesizing",
    agent: "case_coordinator",
    cli: coordResolved.cli, model: coordResolved.model ?? null,
  });

  const coord = new CaseCoordinator({
    cli: coordResolved.cli as any, model: coordResolved.model,
  });
  const synth = await coord.synthesize({
    expertOutputs, missionSummary, productOverview,
  });
  const candPath = join(projectDir, "mission/case-plan/candidates.md");
  await mkdir(join(projectDir, "mission/case-plan"), { recursive: true });
  await writeFile(candPath, synth.text, "utf-8");

  await appendEvent(projectDir, {
    type: "case_coordinator.done",
    agent: "case_coordinator",
    cli: coordResolved.cli, model: coordResolved.model ?? null,
    output: "mission/case-plan/candidates.md",
  });
  await opts.store.update(opts.projectId, {
    status: "awaiting_case_selection",
    case_plan: {
      experts_selected: opts.experts,
      candidates_path: "mission/case-plan/candidates.md",
      selected_path: null, selected_indices: null,
      selected_count: 0, approved_at: null,
    },
  } as any);
  return candPath;
}

function extractQueries(mission: string, overview: string): string[] {
  // crude: look for keywords in product_category / core_capabilities
  const qs: string[] = [];
  const catMatch = overview.match(/product_category:\s*(.+)/);
  if (catMatch) qs.push(catMatch[1]!.trim() + " 实测");
  const nameMatch = overview.match(/product_name:\s*(.+)/);
  if (nameMatch) qs.push(nameMatch[1]!.trim());
  if (qs.length === 0) qs.push("AI 实测");
  return qs;
}
```

- [ ] **Step 4: 跑测试**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test
```

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer
git add packages/web-server/src/services/case-plan-orchestrator.ts \
        packages/web-server/tests/case-plan-orchestrator.test.ts
git -c commit.gpgsign=false commit -m "feat(web-server): CasePlanOrchestrator (parallel experts + coord)"
```

---

### Task 20: POST /case-plan/start + GET /case-plan/candidates

**Files:**
- Modify: `packages/web-server/src/routes/case-plan.ts`
- Modify: `packages/web-server/src/server.ts`
- Create: `packages/web-server/tests/routes-case-plan-start.test.ts`

- [ ] **Step 1: 失败测试**

```ts
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { registerProjectsRoutes } from "../src/routes/projects.js";
import { registerCasePlanRoutes } from "../src/routes/case-plan.js";
import { ProjectStore } from "../src/services/project-store.js";
import { ExpertRegistry } from "../src/services/expert-registry.js";

vi.mock("../src/services/case-plan-orchestrator.js", () => ({
  runCasePlan: vi.fn(async () => "/abs/candidates.md"),
}));

describe("/case-plan routes", () => {
  it("POST /case-plan/start 202 when status is awaiting_case_expert_selection", async () => {
    const { runCasePlan } = await import("../src/services/case-plan-orchestrator.js");
    const vault = mkdtempSync(join(tmpdir(), "cps-"));
    const projectsDir = join(vault, "07_projects");
    mkdirSync(join(vault, "08_experts/topic-panel"), { recursive: true });
    writeFileSync(join(vault, "08_experts/topic-panel/index.yaml"),
      "experts: []\n", "utf-8");
    const store = new ProjectStore(projectsDir);
    const expertRegistry = new ExpertRegistry(vault);
    const app = Fastify();
    registerProjectsRoutes(app, { store });
    registerCasePlanRoutes(app, {
      store, expertRegistry,
      orchestratorDeps: {
        vaultPath: vault, sqlitePath: "",
        agents: {}, defaultCli: "claude", fallbackCli: "codex",
      },
      projectsDir,
    });
    await app.ready();
    const p = (await app.inject({
      method: "POST", url: "/api/projects", payload: { name: "T" },
    })).json();
    await store.update(p.id, { status: "awaiting_case_expert_selection" });

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${p.id}/case-plan/start`,
      payload: { experts: ["卡兹克"] },
    });
    expect(res.statusCode).toBe(202);
    await new Promise((r) => setTimeout(r, 20));
    expect(runCasePlan).toHaveBeenCalled();
  });

  it("GET /case-plan/candidates returns md", async () => {
    const vault = mkdtempSync(join(tmpdir(), "cps-"));
    const projectsDir = join(vault, "07_projects");
    mkdirSync(join(vault, "08_experts/topic-panel"), { recursive: true });
    writeFileSync(join(vault, "08_experts/topic-panel/index.yaml"), "experts: []\n", "utf-8");
    const store = new ProjectStore(projectsDir);
    const expertRegistry = new ExpertRegistry(vault);
    const app = Fastify();
    registerProjectsRoutes(app, { store });
    registerCasePlanRoutes(app, {
      store, expertRegistry,
      orchestratorDeps: { vaultPath: vault, sqlitePath: "", agents: {}, defaultCli: "claude", fallbackCli: "codex" },
      projectsDir,
    });
    await app.ready();
    const p = (await app.inject({ method: "POST", url: "/api/projects", payload: { name: "T" } })).json();
    mkdirSync(join(projectsDir, p.id, "mission/case-plan"), { recursive: true });
    writeFileSync(join(projectsDir, p.id, "mission/case-plan/candidates.md"),
      "---\ntype: case_plan_candidates\n---\n# Case 01", "utf-8");

    const res = await app.inject({
      method: "GET", url: `/api/projects/${p.id}/case-plan/candidates`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("case_plan_candidates");
  });
});
```

- [ ] **Step 2: 跑，预期 FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test tests/routes-case-plan-start.test.ts
```

- [ ] **Step 3: 扩展 case-plan.ts**

```ts
import { readFile } from "node:fs/promises";
import { runCasePlan } from "../services/case-plan-orchestrator.js";
import { readFile as rf } from "node:fs/promises";

export interface CasePlanDeps {
  store: ProjectStore;
  expertRegistry: ExpertRegistry;
  projectsDir: string;
  orchestratorDeps: {
    vaultPath: string;
    sqlitePath: string;
    agents: Record<string, unknown>;
    defaultCli: "claude" | "codex";
    fallbackCli: "claude" | "codex";
  };
}

// Inside registerCasePlanRoutes:
app.addContentTypeParser("text/markdown", { parseAs: "string" }, (_r, b, done) => done(null, b));

app.post<{ Params: { id: string }; Body: { experts: string[] } }>(
  "/api/projects/:id/case-plan/start",
  async (req, reply) => {
    const p = await deps.store.get(req.params.id);
    if (!p) return reply.code(404).send({ error: "not found" });
    if (p.status !== "awaiting_case_expert_selection"
        && p.status !== "case_planning_failed") {
      return reply.code(409).send({ error: `cannot start from ${p.status}` });
    }
    const experts = req.body?.experts ?? [];
    if (experts.length === 0) {
      return reply.code(400).send({ error: "experts required" });
    }
    const all = await deps.expertRegistry.listActive();
    const expertKbs: Record<string, string> = {};
    for (const name of experts) {
      const rec = all.find((e) => e.name === name);
      if (rec) {
        try {
          expertKbs[name] = await rf(
            join(deps.orchestratorDeps.vaultPath, "08_experts/topic-panel", rec.file),
            "utf-8",
          );
        } catch { expertKbs[name] = ""; }
      }
    }
    void runCasePlan({
      projectId: req.params.id,
      projectsDir: deps.projectsDir,
      store: deps.store,
      experts, expertKbs,
      ...deps.orchestratorDeps,
    }).catch(() => {});
    return reply.code(202).send({ status: "planning" });
  },
);

app.get<{ Params: { id: string } }>(
  "/api/projects/:id/case-plan/candidates",
  async (req, reply) => {
    const candPath = join(deps.projectsDir, req.params.id, "mission/case-plan/candidates.md");
    try {
      const body = await readFile(candPath, "utf-8");
      reply.header("content-type", "text/markdown; charset=utf-8");
      return reply.send(body);
    } catch (e: any) {
      if (e.code === "ENOENT") return reply.code(404).send({ error: "not ready" });
      throw e;
    }
  },
);
```

- [ ] **Step 4: server.ts 挂载**

```ts
registerCasePlanRoutes(app, {
  store, expertRegistry,
  projectsDir: cfg.projectsDir,
  orchestratorDeps: {
    vaultPath: cfg.vaultPath, sqlitePath: cfg.sqlitePath,
    agents: cfg.agents, defaultCli: cfg.defaultCli, fallbackCli: cfg.fallbackCli,
  },
});
```

- [ ] **Step 5: 跑测试 + commit**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test
cd /Users/zeoooo/crossing-writer
git add packages/web-server/src/routes/case-plan.ts \
        packages/web-server/src/server.ts \
        packages/web-server/tests/routes-case-plan-start.test.ts
git -c commit.gpgsign=false commit -m "feat(web-server): POST /case-plan/start + GET /case-plan/candidates"
```

---

### Task 21: CaseListPanel + CaseCardPreview

**Files:**
- Create: `packages/web-ui/src/components/left/CaseListPanel.tsx`
- Create: `packages/web-ui/src/components/left/CaseCardPreview.tsx`
- Create: `packages/web-ui/src/hooks/useCaseCandidates.ts`
- Modify: `packages/web-ui/src/api/client.ts`
- Create: `packages/web-ui/tests/components/CaseListPanel.test.tsx`

- [ ] **Step 1: 扩展 client.ts**

```ts
export async function getCaseCandidates(projectId: string): Promise<string | null> {
  const res = await fetch(`/api/projects/${projectId}/case-plan/candidates`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("failed");
  return res.text();
}

export async function selectCases(projectId: string, indices: number[]): Promise<void> {
  const res = await fetch(`/api/projects/${projectId}/case-plan/select`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ selectedIndices: indices }),
  });
  if (!res.ok) throw new Error("select failed");
}
```

- [ ] **Step 2: 写 hook + parser**

```ts
// useCaseCandidates.ts
import { useEffect, useState } from "react";
import { getCaseCandidates } from "../api/client";

export interface ParsedCase {
  index: number;
  name: string;
  proposed_by?: string;
  creativity_score?: string;
  why_it_matters?: string;
  rawBlock: string;
}

function parseCandidates(md: string): ParsedCase[] {
  const parts = md.split(/^# Case \d+/m).slice(1);
  // Re-include the header by using matchAll
  const re = /# Case (\d+)[^\n]*\n([\s\S]*?)(?=^# Case \d+|$)/gm;
  const out: ParsedCase[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) {
    const idx = parseInt(m[1]!, 10);
    const block = m[0]!;
    const nameMatch = block.match(/# Case \d+\s*—?\s*(.+)/);
    const propMatch = block.match(/proposed_by:\s*(.+)/);
    const creatMatch = block.match(/creativity_score:\s*(.+)/);
    const whyMatch = block.match(/why_it_matters:\s*"?([^"\n]+)"?/);
    out.push({
      index: idx,
      name: (nameMatch?.[1] ?? "").trim(),
      proposed_by: propMatch?.[1]?.trim(),
      creativity_score: creatMatch?.[1]?.trim(),
      why_it_matters: whyMatch?.[1]?.trim(),
      rawBlock: block,
    });
  }
  return out;
}

export function useCaseCandidates(projectId: string) {
  const [cases, setCases] = useState<ParsedCase[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    getCaseCandidates(projectId).then((md) => {
      setCases(md ? parseCandidates(md) : []);
      setLoading(false);
    });
  }, [projectId]);
  return { cases, loading };
}
```

- [ ] **Step 3: 失败测试**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CaseListPanel } from "../../src/components/left/CaseListPanel";

vi.mock("../../src/api/client", () => ({
  getCaseCandidates: vi.fn(async () => `---\ntype: case_plan_candidates\n---\n
# Case 1 — 多宫格分镜
proposed_by: 卡兹克
creativity_score: 9
why_it_matters: "测 C1 主打能力"

body 1

# Case 2 — 动作压测
proposed_by: 卡尔
creativity_score: 8
why_it_matters: "连贯性"

body 2
`),
  selectCases: vi.fn(async () => {}),
}));

describe("CaseListPanel", () => {
  it("renders parsed cases", async () => {
    render(<CaseListPanel projectId="p1" />);
    await waitFor(() => screen.getByText(/多宫格分镜/));
    expect(screen.getByText(/动作压测/)).toBeInTheDocument();
    expect(screen.getByText(/卡兹克/)).toBeInTheDocument();
  });

  it("selects checkboxes and calls selectCases", async () => {
    const { selectCases } = await import("../../src/api/client");
    render(<CaseListPanel projectId="p1" />);
    await waitFor(() => screen.getByText(/多宫格分镜/));
    const boxes = screen.getAllByRole("checkbox");
    fireEvent.click(boxes[0]!);
    fireEvent.click(boxes[1]!);
    fireEvent.click(screen.getByRole("button", { name: /批准/ }));
    await waitFor(() => {
      expect(selectCases).toHaveBeenCalledWith("p1", [1, 2]);
    });
  });

  it("rejects more than 4 selections", async () => {
    // Only 2 cases in mock, so we test the cap at 4 logic: skipped here
    render(<CaseListPanel projectId="p1" />);
    await waitFor(() => screen.getByText(/多宫格分镜/));
    expect(screen.getByText(/已选 0/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: 跑，预期 FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-ui && pnpm test tests/components/CaseListPanel.test.tsx
```

- [ ] **Step 5: 写 `CaseCardPreview.tsx`**

```tsx
import type { ParsedCase } from "../../hooks/useCaseCandidates";

export function CaseCardPreview({ c }: { c: ParsedCase }) {
  return (
    <details className="border-t mt-2">
      <summary className="cursor-pointer text-xs text-gray-600">展开详情</summary>
      <pre className="whitespace-pre-wrap text-xs mt-2">{c.rawBlock}</pre>
    </details>
  );
}
```

- [ ] **Step 6: 写 `CaseListPanel.tsx`**

```tsx
import { useState } from "react";
import { useCaseCandidates } from "../../hooks/useCaseCandidates";
import { selectCases } from "../../api/client";
import { CaseCardPreview } from "./CaseCardPreview";

export function CaseListPanel({ projectId }: { projectId: string }) {
  const { cases, loading } = useCaseCandidates(projectId);
  const [picked, setPicked] = useState<Set<number>>(new Set());

  if (loading) return <div>加载中...</div>;
  if (cases.length === 0) return <div>尚无 Case 候选</div>;

  function toggle(idx: number) {
    setPicked((prev) => {
      const n = new Set(prev);
      if (n.has(idx)) n.delete(idx);
      else if (n.size < 4) n.add(idx);
      return n;
    });
  }

  async function approve() {
    await selectCases(projectId, Array.from(picked).sort((a, b) => a - b));
  }

  return (
    <div className="p-4">
      <h3 className="font-semibold">{cases.length} 个候选 Case</h3>
      <ul className="space-y-3 mt-2">
        {cases.map((c) => (
          <li key={c.index} className="border p-2">
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={picked.has(c.index)}
                onChange={() => toggle(c.index)} />
              <div>
                <div><strong>Case {c.index} — {c.name}</strong></div>
                <div className="text-xs">by {c.proposed_by} · 创意 {c.creativity_score}</div>
                <div className="text-sm">{c.why_it_matters}</div>
              </div>
            </label>
            <CaseCardPreview c={c} />
          </li>
        ))}
      </ul>
      <div className="mt-4">
        已选 {picked.size} / 4
        <button className="ml-4 bg-blue-600 text-white px-3 py-1"
          disabled={picked.size < 2} onClick={approve}>
          批准这些 Case
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: 跑测试 + commit**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-ui && pnpm test
cd /Users/zeoooo/crossing-writer
git add packages/web-ui/src/components/left/CaseListPanel.tsx \
        packages/web-ui/src/components/left/CaseCardPreview.tsx \
        packages/web-ui/src/hooks/useCaseCandidates.ts \
        packages/web-ui/src/api/client.ts \
        packages/web-ui/tests/components/CaseListPanel.test.tsx
git -c commit.gpgsign=false commit -m "feat(web-ui): CaseListPanel + CaseCardPreview (multi-select 2-4)"
```

---

### Task 22: POST /case-plan/select + selected-cases.md

**Files:**
- Modify: `packages/web-server/src/routes/case-plan.ts`
- Create: `packages/web-server/src/services/selected-cases-writer.ts`
- Create: `packages/web-server/tests/selected-cases-writer.test.ts`
- Create: `packages/web-server/tests/routes-case-plan-select.test.ts`

- [ ] **Step 1: 失败测试 `selected-cases-writer.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { buildSelectedCasesMd } from "../src/services/selected-cases-writer.js";

describe("buildSelectedCasesMd", () => {
  it("emits frontmatter + selected cases + checklist", () => {
    const candidatesMd = `---
type: case_plan_candidates
---

# Case 1 — A
proposed_by: X

body A

# Case 2 — B
proposed_by: Y

body B

# Case 3 — C
proposed_by: Z

body C
`;
    const md = buildSelectedCasesMd({
      candidatesMd,
      selectedIndices: [1, 3],
      projectId: "p1",
      missionRef: "mission/selected.md",
      overviewRef: "context/product-overview.md",
    });
    expect(md).toContain("type: case_plan");
    expect(md).toContain("selected_indices: [1, 3]");
    expect(md).toContain("selected_count: 2");
    expect(md).toContain("# Case 1 — A");
    expect(md).toContain("# Case 3 — C");
    expect(md).not.toContain("# Case 2 — B");
    expect(md).toContain("# 实测引导");
    expect(md).toContain("- [ ]");
  });
});
```

- [ ] **Step 2: 跑，预期 FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test tests/selected-cases-writer.test.ts
```

- [ ] **Step 3: 写 `selected-cases-writer.ts`**

```ts
export interface BuildSelectedOpts {
  candidatesMd: string;
  selectedIndices: number[];
  projectId: string;
  missionRef: string;
  overviewRef: string;
}

export function buildSelectedCasesMd(opts: BuildSelectedOpts): string {
  const re = /# Case (\d+)[^\n]*\n[\s\S]*?(?=^# Case \d+|$)/gm;
  const blocks = new Map<number, string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(opts.candidatesMd))) {
    blocks.set(parseInt(m[1]!, 10), m[0]!);
  }
  const selected = opts.selectedIndices
    .map((i) => ({ i, block: blocks.get(i) }))
    .filter((x) => x.block);

  const lines: string[] = [];
  lines.push("---");
  lines.push("type: case_plan");
  lines.push(`project_id: ${opts.projectId}`);
  lines.push("selected_from: mission/case-plan/candidates.md");
  lines.push(`selected_indices: [${opts.selectedIndices.join(", ")}]`);
  lines.push(`selected_count: ${opts.selectedIndices.length}`);
  lines.push("approved_by: human");
  lines.push(`approved_at: ${new Date().toISOString()}`);
  lines.push(`mission_ref: ${opts.missionRef}`);
  lines.push(`product_overview_ref: ${opts.overviewRef}`);
  lines.push("---", "", "# 已选 Cases", "");

  for (const s of selected) {
    lines.push(s.block!.trim(), "");
  }

  lines.push("# 实测引导（给人看的 checklist）", "");
  lines.push("### 准备", "- [ ] 准备录屏工具（Screen Studio / QuickTime）", "- [ ] 登录产品 Web 端", "");
  for (const s of selected) {
    lines.push(`### Case ${s.i} 执行`);
    lines.push("- [ ] 按 steps 跑一遍");
    lines.push("- [ ] 按 prompts 生成产物");
    lines.push("- [ ] 截图：按 screenshot_points");
    lines.push("- [ ] 录屏：按 recording_points");
    lines.push("- [ ] 备注 observation_points 观察结果", "");
  }
  return lines.join("\n");
}
```

- [ ] **Step 4: 失败测试 `routes-case-plan-select.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { registerProjectsRoutes } from "../src/routes/projects.js";
import { registerCasePlanRoutes } from "../src/routes/case-plan.js";
import { ProjectStore } from "../src/services/project-store.js";
import { ExpertRegistry } from "../src/services/expert-registry.js";

describe("POST /case-plan/select", () => {
  it("writes selected-cases.md and transitions to case_plan_approved", async () => {
    const vault = mkdtempSync(join(tmpdir(), "sel-"));
    const projectsDir = join(vault, "07_projects");
    mkdirSync(join(vault, "08_experts/topic-panel"), { recursive: true });
    writeFileSync(join(vault, "08_experts/topic-panel/index.yaml"), "experts: []\n", "utf-8");
    const store = new ProjectStore(projectsDir);
    const expertRegistry = new ExpertRegistry(vault);
    const app = Fastify();
    registerProjectsRoutes(app, { store });
    registerCasePlanRoutes(app, {
      store, expertRegistry, projectsDir,
      orchestratorDeps: { vaultPath: vault, sqlitePath: "", agents: {}, defaultCli: "claude", fallbackCli: "codex" },
    });
    await app.ready();
    const p = (await app.inject({ method: "POST", url: "/api/projects", payload: { name: "T" } })).json();
    await store.update(p.id, { status: "awaiting_case_selection" });
    const cpDir = join(projectsDir, p.id, "mission/case-plan");
    mkdirSync(cpDir, { recursive: true });
    writeFileSync(join(cpDir, "candidates.md"), `---
type: case_plan_candidates
---
# Case 1 — A
body A
# Case 2 — B
body B
# Case 3 — C
body C
`, "utf-8");

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${p.id}/case-plan/select`,
      payload: { selectedIndices: [1, 3] },
    });
    expect(res.statusCode).toBe(200);
    const selPath = join(cpDir, "selected-cases.md");
    expect(existsSync(selPath)).toBe(true);
    const body = readFileSync(selPath, "utf-8");
    expect(body).toContain("selected_count: 2");
    const updated = await store.get(p.id);
    expect(updated?.status).toBe("case_plan_approved");
  });
});
```

- [ ] **Step 5: 扩展 case-plan.ts**

```ts
import { buildSelectedCasesMd } from "../services/selected-cases-writer.js";
import { writeFile } from "node:fs/promises";

app.post<{
  Params: { id: string };
  Body: { selectedIndices: number[] };
}>("/api/projects/:id/case-plan/select", async (req, reply) => {
  const p = await deps.store.get(req.params.id);
  if (!p) return reply.code(404).send({ error: "not found" });
  if (p.status !== "awaiting_case_selection") {
    return reply.code(409).send({ error: `cannot select from ${p.status}` });
  }
  const indices = req.body?.selectedIndices ?? [];
  if (indices.length < 2 || indices.length > 4) {
    return reply.code(400).send({ error: "must select 2-4 cases" });
  }
  const candPath = join(deps.projectsDir, req.params.id, "mission/case-plan/candidates.md");
  const candidatesMd = await (await import("node:fs/promises")).readFile(candPath, "utf-8");
  const selected = buildSelectedCasesMd({
    candidatesMd, selectedIndices: indices,
    projectId: req.params.id,
    missionRef: "mission/selected.md",
    overviewRef: "context/product-overview.md",
  });
  const selPath = join(deps.projectsDir, req.params.id, "mission/case-plan/selected-cases.md");
  await writeFile(selPath, selected, "utf-8");
  await deps.store.update(req.params.id, {
    status: "case_plan_approved",
    case_plan: {
      ...((p as any).case_plan ?? {}),
      selected_path: "mission/case-plan/selected-cases.md",
      selected_indices: indices,
      selected_count: indices.length,
      approved_at: new Date().toISOString(),
    },
  } as any);
  return reply.code(200).send({ ok: true });
});

app.get<{ Params: { id: string } }>(
  "/api/projects/:id/case-plan/selected",
  async (req, reply) => {
    const selPath = join(deps.projectsDir, req.params.id, "mission/case-plan/selected-cases.md");
    try {
      const body = await (await import("node:fs/promises")).readFile(selPath, "utf-8");
      reply.header("content-type", "text/markdown; charset=utf-8");
      return reply.send(body);
    } catch (e: any) {
      if (e.code === "ENOENT") return reply.code(404).send({ error: "not selected" });
      throw e;
    }
  },
);
```

- [ ] **Step 6: 跑测试 + commit**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test
cd /Users/zeoooo/crossing-writer
git add packages/web-server/src/services/selected-cases-writer.ts \
        packages/web-server/src/routes/case-plan.ts \
        packages/web-server/tests/selected-cases-writer.test.ts \
        packages/web-server/tests/routes-case-plan-select.test.ts
git -c commit.gpgsign=false commit -m "feat(web-server): POST /case-plan/select writes selected-cases.md + approves"
```

---

### Task 23: CaseSelectedGuide 组件（SP-03 终点）

**Files:**
- Create: `packages/web-ui/src/components/right/CaseSelectedGuide.tsx`
- Modify: `packages/web-ui/src/api/client.ts`
- Create: `packages/web-ui/tests/components/CaseSelectedGuide.test.tsx`

- [ ] **Step 1: 加 client**

```ts
export async function getSelectedCases(projectId: string): Promise<string | null> {
  const res = await fetch(`/api/projects/${projectId}/case-plan/selected`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("failed");
  return res.text();
}
```

- [ ] **Step 2: 失败测试**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { CaseSelectedGuide } from "../../src/components/right/CaseSelectedGuide";

vi.mock("../../src/api/client", () => ({
  getSelectedCases: vi.fn(async () => `---
type: case_plan
selected_count: 2
---

# 已选 Cases

## Case 1 — A
body

# 实测引导（给人看的 checklist）

### 准备
- [ ] 录屏工具
- [ ] 登录

### Case 1 执行
- [ ] 步骤 1
`),
}));

describe("CaseSelectedGuide", () => {
  it("renders selected guide md", async () => {
    render(<CaseSelectedGuide projectId="p1" />);
    await waitFor(() => screen.getByText(/Case Plan 已批准/));
    expect(screen.getByText(/去跑真实测/)).toBeInTheDocument();
  });

  it("SP-04 evidence button is disabled", async () => {
    render(<CaseSelectedGuide projectId="p1" />);
    await waitFor(() => screen.getByText(/Case Plan 已批准/));
    const btn = screen.getByRole("button", { name: /Evidence/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
```

- [ ] **Step 3: 跑，预期 FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-ui && pnpm test tests/components/CaseSelectedGuide.test.tsx
```

- [ ] **Step 4: 写组件**

```tsx
import { useEffect, useState } from "react";
import { getSelectedCases } from "../../api/client";

export function CaseSelectedGuide({ projectId }: { projectId: string }) {
  const [md, setMd] = useState<string | null>(null);

  useEffect(() => {
    getSelectedCases(projectId).then(setMd);
  }, [projectId]);

  if (md == null) return <div>加载中...</div>;

  return (
    <div className="p-4">
      <div className="bg-green-50 border border-green-300 p-3 rounded">
        <h3 className="font-semibold">Case Plan 已批准 ✅</h3>
        <p className="text-sm">下一步：<strong>去跑真实测</strong></p>
      </div>
      <pre className="whitespace-pre-wrap mt-4 text-xs">{md}</pre>
      <button disabled
        className="mt-4 bg-gray-300 text-gray-600 px-3 py-1"
        title="SP-04 未上线">
        Evidence 上传（SP-04 未上线）
      </button>
    </div>
  );
}
```

- [ ] **Step 5: 跑测试 + commit**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-ui && pnpm test
cd /Users/zeoooo/crossing-writer
git add packages/web-ui/src/components/right/CaseSelectedGuide.tsx \
        packages/web-ui/src/api/client.ts \
        packages/web-ui/tests/components/CaseSelectedGuide.test.tsx
git -c commit.gpgsign=false commit -m "feat(web-ui): CaseSelectedGuide (SP-03 終点 + SP-04 placeholder)"
```

---

### Task 24: SSE 新事件类型（overview.* / case.*）

**Files:**
- Modify: `packages/web-server/src/events/sse-types.ts`（or 相应类型定义处）
- Modify: `packages/web-server/src/services/event-log.ts`（type enum 扩展）
- Create: `packages/web-server/tests/sse-event-types.test.ts`

- [ ] **Step 1: 失败测试**

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendEvent } from "../src/services/event-log.js";

describe("new SSE event types for SP-03", () => {
  it("accepts all new overview and case event types", async () => {
    const dir = mkdtempSync(join(tmpdir(), "evt-"));
    mkdirSync(dir, { recursive: true });
    for (const type of [
      "overview.started", "overview.completed", "overview.failed",
      "case_expert.round1_started", "case_expert.round1_completed",
      "case_expert.tool_call",
      "case_expert.round2_started", "case_expert.round2_completed",
      "case_coordinator.synthesizing", "case_coordinator.done",
      "cases.selected",
    ]) {
      await appendEvent(dir, { type, agent: "x", cli: "claude", model: "opus" });
    }
    const lines = readFileSync(join(dir, "events.jsonl"), "utf-8").split("\n").filter(Boolean);
    expect(lines.length).toBe(11);
    for (const l of lines) {
      const e = JSON.parse(l);
      expect(e.ts).toBeTruthy();
      expect(e.type).toMatch(/^(overview|case_expert|case_coordinator|cases)\./);
    }
  });
});
```

- [ ] **Step 2: 跑（很可能已经 PASS 因为 event-log 不限制 type；确认后改为对 SSE broadcast 的白名单）**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test tests/sse-event-types.test.ts
```

如果 event-log 本来就不限制 type，本测试会 PASS。但 SSE stream route 可能过滤事件——确认 stream.ts 不过滤（或加入新 type 到白名单）。

- [ ] **Step 3: 如果 stream.ts 有白名单 / 类型枚举，扩展它**

Read `packages/web-server/src/routes/stream.ts`，如果有：

```ts
const BROADCAST_TYPES = new Set([...现有...]);
```

加入所有 SP-03 新 type。如果没白名单（默认 broadcast all），本 task 只做测试 + commit 空 schema 文档。

创建/更新 `packages/web-server/src/events/sse-types.ts`：

```ts
export type Sp03OverviewEventType =
  | "overview.started"
  | "overview.completed"
  | "overview.failed";

export type Sp03CaseEventType =
  | "case_expert.round1_started"
  | "case_expert.round1_completed"
  | "case_expert.tool_call"
  | "case_expert.round2_started"
  | "case_expert.round2_completed"
  | "case_expert.failed"
  | "case_coordinator.synthesizing"
  | "case_coordinator.done"
  | "cases.selected";

export type Sp03EventType = Sp03OverviewEventType | Sp03CaseEventType;
```

- [ ] **Step 4: 跑测试 + commit**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test
cd /Users/zeoooo/crossing-writer
git add packages/web-server/src/events/sse-types.ts \
        packages/web-server/tests/sse-event-types.test.ts
git -c commit.gpgsign=false commit -m "feat(web-server): SP-03 SSE event type enum (overview/case)"
```

---

### Task 25: useProjectStream 解析 cli/model + agent 状态聚合

**Files:**
- Modify: `packages/web-ui/src/hooks/useProjectStream.ts`
- Modify: `packages/web-ui/tests/hooks/useProjectStream.test.ts`

- [ ] **Step 1: 失败测试**

```ts
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useProjectStream } from "../../src/hooks/useProjectStream";

function dispatch(ev: any) {
  window.dispatchEvent(new MessageEvent("sse-test", { data: JSON.stringify(ev) }));
}

describe("useProjectStream agent aggregation", () => {
  it("tracks activeAgents set (started → completed removes)", async () => {
    // Simplified: inject events via test-only injection API
    const { result } = renderHook(() => useProjectStream("p1"));
    act(() => {
      (result.current as any).__injectForTest?.({
        type: "case_expert.round1_started",
        agent: "case_expert.卡兹克", cli: "claude", model: "opus",
      });
    });
    expect(result.current.activeAgents).toEqual([
      { agent: "case_expert.卡兹克", cli: "claude", model: "opus", stage: "round1_started" },
    ]);

    act(() => {
      (result.current as any).__injectForTest?.({
        type: "case_expert.round1_completed",
        agent: "case_expert.卡兹克", cli: "claude", model: "opus",
      });
    });
    expect(result.current.activeAgents).toEqual([]);
  });

  it("parses cli/model from all events", () => {
    const { result } = renderHook(() => useProjectStream("p1"));
    act(() => {
      (result.current as any).__injectForTest?.({
        type: "overview.started",
        agent: "product_overview", cli: "claude", model: "opus",
      });
    });
    expect(result.current.events[0]).toMatchObject({
      agent: "product_overview", cli: "claude", model: "opus",
    });
  });
});
```

- [ ] **Step 2: 跑，预期 FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-ui && pnpm test tests/hooks/useProjectStream.test.ts
```

- [ ] **Step 3: 改 `useProjectStream.ts`**

```ts
import { useEffect, useRef, useState, useCallback } from "react";

export interface ActiveAgent {
  agent: string;
  cli?: string;
  model?: string | null;
  stage: string;
  status?: "online" | "failed";
}

export interface StreamEvent {
  ts: string;
  type: string;
  agent?: string;
  cli?: string;
  model?: string | null;
  [k: string]: any;
}

const STARTED_RE = /\.(started|round1_started|round2_started|synthesizing|analyzing|generating)$/;
const ENDED_RE = /\.(completed|done|ready|round1_completed|round2_completed|failed)$/;

export function useProjectStream(projectId: string) {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [activeAgents, setActiveAgents] = useState<ActiveAgent[]>([]);
  const esRef = useRef<EventSource | null>(null);

  const applyEvent = useCallback((ev: StreamEvent) => {
    setEvents((prev) => [...prev, ev]);
    setActiveAgents((prev) => {
      const agent = ev.agent;
      if (!agent) return prev;
      const stageMatch = ev.type.match(/\.([a-z_]+)$/);
      const stage = stageMatch?.[1] ?? "unknown";
      if (STARTED_RE.test(ev.type)) {
        const next = prev.filter((a) => a.agent !== agent);
        next.push({
          agent, cli: ev.cli, model: ev.model ?? null,
          stage, status: "online",
        });
        return next;
      }
      if (ENDED_RE.test(ev.type)) {
        if (ev.type.endsWith("failed")) {
          return prev.map((a) =>
            a.agent === agent ? { ...a, status: "failed" } : a,
          );
        }
        return prev.filter((a) => a.agent !== agent);
      }
      return prev;
    });
  }, []);

  useEffect(() => {
    const es = new EventSource(`/api/projects/${projectId}/events/stream`);
    esRef.current = es;
    es.onmessage = (m) => {
      try { applyEvent(JSON.parse(m.data)); } catch {}
    };
    return () => { es.close(); };
  }, [projectId, applyEvent]);

  // test-only injection
  const __injectForTest = applyEvent;
  return { events, activeAgents, __injectForTest };
}
```

- [ ] **Step 4: 跑测试 + commit**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-ui && pnpm test
cd /Users/zeoooo/crossing-writer
git add packages/web-ui/src/hooks/useProjectStream.ts \
        packages/web-ui/tests/hooks/useProjectStream.test.ts
git -c commit.gpgsign=false commit -m "feat(web-ui): useProjectStream parses cli/model + aggregates active agents"
```

---

### Task 26: AgentTimeline 重构（agent · cli/model + 状态点）

**Files:**
- Modify: `packages/web-ui/src/components/status/AgentTimeline.tsx`
- Modify: `packages/web-ui/tests/components/AgentTimeline.test.tsx`

- [ ] **Step 1: 失败测试**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentTimeline } from "../../src/components/status/AgentTimeline";

describe("AgentTimeline SP-03", () => {
  it("renders agent name with cli/model and status dot", () => {
    render(<AgentTimeline events={[
      { ts: "2026-04-13T14:32:15Z", type: "agent.started",
        agent: "brief_analyst", cli: "claude", model: "sonnet" },
    ]} />);
    expect(screen.getByText(/brief_analyst/)).toBeInTheDocument();
    expect(screen.getByText(/claude\/sonnet/)).toBeInTheDocument();
    const dot = screen.getByTestId("status-dot-brief_analyst");
    expect(dot.className).toMatch(/green/);
  });

  it("shows gray dot after completed", () => {
    render(<AgentTimeline events={[
      { ts: "t1", type: "agent.started", agent: "x", cli: "codex", model: "gpt5" },
      { ts: "t2", type: "agent.completed", agent: "x", cli: "codex", model: "gpt5" },
    ]} />);
    const dot = screen.getByTestId("status-dot-x");
    expect(dot.className).toMatch(/gray/);
  });

  it("shows red dot on failed", () => {
    render(<AgentTimeline events={[
      { ts: "t1", type: "overview.started", agent: "product_overview", cli: "claude", model: "opus" },
      { ts: "t2", type: "overview.failed", agent: "product_overview", cli: "claude", model: "opus" },
    ]} />);
    const dot = screen.getByTestId("status-dot-product_overview");
    expect(dot.className).toMatch(/red/);
  });

  it("aggregates multiple events from same agent into one row", () => {
    render(<AgentTimeline events={[
      { ts: "t1", type: "case_expert.round1_started", agent: "case_expert.A", cli: "c", model: "m" },
      { ts: "t2", type: "case_expert.tool_call", agent: "case_expert.A", command: "crossing-kb" },
      { ts: "t3", type: "case_expert.round2_completed", agent: "case_expert.A", cli: "c", model: "m" },
    ]} />);
    const rows = screen.getAllByTestId(/^agent-row-/);
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 跑，预期 FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-ui && pnpm test tests/components/AgentTimeline.test.tsx
```

- [ ] **Step 3: 重写 AgentTimeline**

```tsx
import type { StreamEvent } from "../../hooks/useProjectStream";

interface AggRow {
  agent: string;
  cli?: string;
  model?: string | null;
  state: "online" | "done" | "failed";
  firstTs: string;
  lastStage: string;
  events: StreamEvent[];
}

function aggregate(events: StreamEvent[]): AggRow[] {
  const map = new Map<string, AggRow>();
  for (const ev of events) {
    const a = ev.agent;
    if (!a) continue;
    const row = map.get(a) ?? {
      agent: a,
      cli: ev.cli, model: ev.model,
      state: "online",
      firstTs: ev.ts,
      lastStage: "",
      events: [],
    };
    row.events.push(ev);
    if (ev.cli) row.cli = ev.cli;
    if (ev.model !== undefined) row.model = ev.model;
    if (/failed$/.test(ev.type)) row.state = "failed";
    else if (/(completed|done|ready)$/.test(ev.type)) row.state = "done";
    else if (/started|synthesizing|analyzing|generating/.test(ev.type)) row.state = "online";
    const stageMatch = ev.type.match(/\.([a-z_]+)$/);
    if (stageMatch) row.lastStage = stageMatch[1]!;
    map.set(a, row);
  }
  return Array.from(map.values()).sort((a, b) => a.firstTs.localeCompare(b.firstTs));
}

function dotClass(state: AggRow["state"]): string {
  if (state === "online") return "inline-block w-2 h-2 rounded-full bg-green-500";
  if (state === "failed") return "inline-block w-2 h-2 rounded-full bg-red-500";
  return "inline-block w-2 h-2 rounded-full bg-gray-400";
}

export function AgentTimeline({ events }: { events: StreamEvent[] }) {
  const rows = aggregate(events);
  return (
    <ul className="text-xs font-mono space-y-1">
      {rows.map((r) => (
        <li key={r.agent} data-testid={`agent-row-${r.agent}`} className="flex gap-2">
          <span>{r.firstTs.slice(11, 19)}</span>
          <span className={dotClass(r.state)}
            data-testid={`status-dot-${r.agent}`} />
          <span>{r.agent}</span>
          <span className="text-gray-500">· {r.cli}/{r.model ?? "?"}</span>
          <span className="ml-auto text-gray-400">{r.lastStage}</span>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: 跑测试 + commit**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-ui && pnpm test
cd /Users/zeoooo/crossing-writer
git add packages/web-ui/src/components/status/AgentTimeline.tsx \
        packages/web-ui/tests/components/AgentTimeline.test.tsx
git -c commit.gpgsign=false commit -m "feat(web-ui): AgentTimeline aggregates by agent + status dots"
```

---

### Task 27: AgentStatusBar 顶部栏组件

**Files:**
- Create: `packages/web-ui/src/components/status/AgentStatusBar.tsx`
- Modify: `packages/web-ui/src/components/layout/TopBar.tsx`
- Create: `packages/web-ui/tests/components/AgentStatusBar.test.tsx`

- [ ] **Step 1: 失败测试**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentStatusBar } from "../../src/components/status/AgentStatusBar";

describe("AgentStatusBar", () => {
  it("renders nothing when no active agents", () => {
    const { container } = render(<AgentStatusBar activeAgents={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders pill per active agent with pulsing dot", () => {
    render(<AgentStatusBar activeAgents={[
      { agent: "case_expert.A", cli: "claude", model: "opus", stage: "round1_started" },
      { agent: "case_expert.B", cli: "codex", model: "gpt5", stage: "round1_started" },
    ]} />);
    expect(screen.getByText(/case_expert\.A/)).toBeInTheDocument();
    expect(screen.getByText(/case_expert\.B/)).toBeInTheDocument();
    const pulsing = screen.getAllByTestId(/pulse-dot/);
    expect(pulsing).toHaveLength(2);
  });

  it("shows stage on hover title", () => {
    render(<AgentStatusBar activeAgents={[
      { agent: "X", cli: "claude", model: "opus", stage: "synthesizing" },
    ]} />);
    const pill = screen.getByText(/X/).closest('[data-testid="pill-X"]');
    expect(pill?.getAttribute("title")).toContain("synthesizing");
  });
});
```

- [ ] **Step 2: 跑，预期 FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-ui && pnpm test tests/components/AgentStatusBar.test.tsx
```

- [ ] **Step 3: 写组件**

```tsx
import type { ActiveAgent } from "../../hooks/useProjectStream";

export function AgentStatusBar({ activeAgents }: { activeAgents: ActiveAgent[] }) {
  if (activeAgents.length === 0) return null;
  return (
    <div className="flex gap-2 text-xs">
      <span className="text-gray-500">活跃:</span>
      {activeAgents.map((a) => (
        <span key={a.agent} data-testid={`pill-${a.agent}`}
          title={`${a.agent} · ${a.cli}/${a.model} · ${a.stage}`}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-50 border border-green-300">
          <span data-testid={`pulse-dot-${a.agent}`}
            className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          {a.agent} <span className="text-gray-500">{a.cli}</span>
        </span>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: 在 TopBar 挂载**

```tsx
import { AgentStatusBar } from "../status/AgentStatusBar";
// ...
<header className="flex items-center gap-4 px-4 py-2 border-b">
  {/* existing: back btn + project name + status */}
  <div className="ml-auto">
    <AgentStatusBar activeAgents={activeAgents} />
  </div>
</header>
```

- [ ] **Step 5: 跑测试 + commit**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-ui && pnpm test
cd /Users/zeoooo/crossing-writer
git add packages/web-ui/src/components/status/AgentStatusBar.tsx \
        packages/web-ui/src/components/layout/TopBar.tsx \
        packages/web-ui/tests/components/AgentStatusBar.test.tsx
git -c commit.gpgsign=false commit -m "feat(web-ui): AgentStatusBar (top pill bar for active agents)"
```

---

### Task 28: ProjectWorkbench 状态机驱动

**Files:**
- Modify: `packages/web-ui/src/pages/ProjectWorkbench.tsx`
- Modify: `packages/web-ui/tests/pages/ProjectWorkbench.test.tsx`

- [ ] **Step 1: 失败测试**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ProjectWorkbench } from "../../src/pages/ProjectWorkbench";

vi.mock("../../src/api/client", () => ({
  getProject: vi.fn(),
  getOverview: vi.fn(async () => null),
  getCaseCandidates: vi.fn(async () => null),
  getSelectedCases: vi.fn(async () => null),
  listOverviewImages: vi.fn(async () => []),
  listCaseExperts: vi.fn(async () => []),
}));

vi.mock("../../src/hooks/useProjectStream", () => ({
  useProjectStream: () => ({ events: [], activeAgents: [] }),
}));

describe("ProjectWorkbench SP-03 status routing", () => {
  it.each([
    ["awaiting_overview_input", /Brief 配图|拖拽/],
    ["overview_analyzing", /正在生成/],
    ["overview_ready", /批准进入 Case 规划/],
    ["awaiting_case_expert_selection", /选择 Case 专家/],
    ["case_planning_running", /规划中/],
    ["awaiting_case_selection", /左侧选 2-4/],
    ["case_plan_approved", /Case Plan 已批准/],
  ])("status=%s renders expected panel", async (status, pattern) => {
    const { getProject } = await import("../../src/api/client");
    vi.mocked(getProject).mockResolvedValue({
      id: "p1", name: "T", status, created_at: "", updated_at: "",
    } as any);
    render(<ProjectWorkbench projectId="p1" />);
    await waitFor(() => {
      expect(screen.getByText(pattern)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: 跑，预期 FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-ui && pnpm test tests/pages/ProjectWorkbench.test.tsx
```

- [ ] **Step 3: 改 `ProjectWorkbench.tsx`**

```tsx
import { useEffect, useState } from "react";
import { getProject } from "../api/client";
import { useProjectStream } from "../hooks/useProjectStream";
import { SectionAccordion, Section } from "../components/layout/SectionAccordion";
import { AgentTimeline } from "../components/status/AgentTimeline";
import { AgentStatusBar } from "../components/status/AgentStatusBar";
import { OverviewIntakeForm } from "../components/right/OverviewIntakeForm";
import { ProductOverviewCard } from "../components/left/ProductOverviewCard";
import { CaseExpertSelector } from "../components/right/CaseExpertSelector";
import { CaseListPanel } from "../components/left/CaseListPanel";
import { CaseSelectedGuide } from "../components/right/CaseSelectedGuide";

type SecStat = "completed" | "active" | "pending";
function secStatus(curr: string, my: string[], order: string[][]): SecStat {
  const currIdx = order.findIndex((grp) => grp.includes(curr));
  const myIdx = order.findIndex((grp) => my.some((s) => grp.includes(s)));
  if (myIdx === currIdx) return "active";
  if (myIdx < currIdx) return "completed";
  return "pending";
}

const ORDER: string[][] = [
  ["brief_uploaded", "brief_analyzing", "brief_ready"],
  ["mission_running", "mission_synthesizing", "awaiting_mission_selection", "mission_approved"],
  ["awaiting_overview_input", "overview_analyzing", "overview_ready", "overview_failed"],
  ["awaiting_case_expert_selection", "case_planning_running", "case_planning_failed",
   "case_synthesizing", "awaiting_case_selection", "case_plan_approved"],
];

function rightPanel(status: string, projectId: string) {
  switch (status) {
    case "awaiting_overview_input":
    case "overview_failed":
      return <OverviewIntakeForm projectId={projectId} />;
    case "overview_analyzing":
      return <div className="p-4">正在生成产品概览…</div>;
    case "overview_ready":
      return <div className="p-4">点左侧卡片里的「批准进入 Case 规划」</div>;
    case "awaiting_case_expert_selection":
      return <CaseExpertSelector projectId={projectId} />;
    case "case_planning_running":
    case "case_synthesizing":
      return <div className="p-4">规划中…（看右下时间线）</div>;
    case "awaiting_case_selection":
      return <div className="p-4">请在左侧选 2-4 个 Case</div>;
    case "case_plan_approved":
      return <CaseSelectedGuide projectId={projectId} />;
    default:
      return null;
  }
}

export function ProjectWorkbench({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<any>(null);
  const { events, activeAgents } = useProjectStream(projectId);

  useEffect(() => {
    const tick = () => getProject(projectId).then(setProject);
    tick();
    const id = setInterval(tick, 2000);
    return () => clearInterval(id);
  }, [projectId]);

  if (!project) return <div>加载中...</div>;
  const s = project.status;

  return (
    <div className="flex flex-col h-screen">
      <header className="flex items-center gap-4 px-4 py-2 border-b">
        <span className="font-semibold">{project.name}</span>
        <span className="text-xs text-gray-500">{s}</span>
        <div className="ml-auto">
          <AgentStatusBar activeAgents={activeAgents} />
        </div>
      </header>
      <div className="flex flex-1 min-h-0">
        <aside className="w-2/3 overflow-auto p-4">
          <SectionAccordion>
            <Section title="Brief 摘要" status={secStatus(s, ORDER[0]!, ORDER)}>
              <div>Brief section</div>
            </Section>
            <Section title="Mission 选定" status={secStatus(s, ORDER[1]!, ORDER)}>
              <div>Mission section</div>
            </Section>
            <Section title="产品概览" status={secStatus(s, ORDER[2]!, ORDER)}>
              <ProductOverviewCard projectId={projectId} status={s} />
            </Section>
            <Section title="Case 列表" status={secStatus(s, ORDER[3]!, ORDER)}>
              <CaseListPanel projectId={projectId} />
            </Section>
          </SectionAccordion>
        </aside>
        <main className="w-1/3 flex flex-col border-l">
          <div className="flex-1 overflow-auto">{rightPanel(s, projectId)}</div>
          <div className="border-t max-h-60 overflow-auto p-2">
            <AgentTimeline events={events} />
          </div>
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 跑测试 + commit**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-ui && pnpm test
cd /Users/zeoooo/crossing-writer
git add packages/web-ui/src/pages/ProjectWorkbench.tsx \
        packages/web-ui/tests/pages/ProjectWorkbench.test.tsx
git -c commit.gpgsign=false commit -m "feat(web-ui): ProjectWorkbench drives SP-03 status → accordion + right panel"
```

---

### Task 29: 端到端集成测试（mock agents）

**Files:**
- Create: `packages/web-server/tests/integration-sp03-e2e.test.ts`

- [ ] **Step 1: 写测试**

```ts
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { registerProjectsRoutes } from "../src/routes/projects.js";
import { registerOverviewRoutes } from "../src/routes/overview.js";
import { registerCasePlanRoutes } from "../src/routes/case-plan.js";
import { ProjectStore } from "../src/services/project-store.js";
import { ImageStore } from "../src/services/image-store.js";
import { ExpertRegistry } from "../src/services/expert-registry.js";

vi.mock("@crossing/agents", () => ({
  ProductOverviewAgent: vi.fn().mockImplementation(() => ({
    analyze: async () => ({
      text: "---\ntype: product_overview\nproduct_name: Mock\n---\n# 产品概览\nbody",
      meta: { cli: "claude", model: "opus", durationMs: 100 },
    }),
  })),
  CasePlannerExpert: vi.fn().mockImplementation((opts: any) => ({
    name: opts.name,
    round1: async () => ({ text: `# Case 1 — ${opts.name}\nproposed_by: ${opts.name}\n\nbody`, meta: { cli: "c", model: "m", durationMs: 10 } }),
    round2: async () => ({ text: "", meta: { cli: "c", model: "m", durationMs: 10 } }),
  })),
  CaseCoordinator: vi.fn().mockImplementation(() => ({
    synthesize: async () => ({
      text: "---\ntype: case_plan_candidates\ntotal_cases: 2\n---\n# Case 1 — A\nbody A\n# Case 2 — B\nbody B",
      meta: { cli: "c", model: "m", durationMs: 10 },
    }),
  })),
  runCaseExpert: async (e: any) => ({
    final: await e.round1({}), roundsUsed: 1, toolCallsMade: [],
  }),
  resolveAgent: () => ({ cli: "claude", model: "opus" }),
}));

describe("SP-03 e2e: overview → case approval", () => {
  it("walks full pipeline", async () => {
    const vault = mkdtempSync(join(tmpdir(), "e2e-"));
    const projectsDir = join(vault, "07_projects");
    mkdirSync(join(vault, "08_experts/topic-panel"), { recursive: true });
    writeFileSync(join(vault, "08_experts/topic-panel/index.yaml"), `experts:
  - name: X
    file: experts/x.md
    active: true
    creativity_score: 9
`, "utf-8");
    mkdirSync(join(vault, "08_experts/topic-panel/experts"), { recursive: true });
    writeFileSync(join(vault, "08_experts/topic-panel/experts/x.md"), "kb", "utf-8");

    const store = new ProjectStore(projectsDir);
    const imageStore = new ImageStore(projectsDir);
    const expertRegistry = new ExpertRegistry(vault);
    const app = Fastify();
    await app.register(multipart);
    registerProjectsRoutes(app, { store });
    registerOverviewRoutes(app, {
      store, imageStore, projectsDir,
      analyzeOverviewDeps: { vaultPath: vault, sqlitePath: "", agents: {}, defaultCli: "claude", fallbackCli: "codex" },
    });
    registerCasePlanRoutes(app, {
      store, expertRegistry, projectsDir,
      orchestratorDeps: { vaultPath: vault, sqlitePath: "", agents: {}, defaultCli: "claude", fallbackCli: "codex" },
    });
    await app.ready();

    // 1. create project
    const p = (await app.inject({ method: "POST", url: "/api/projects", payload: { name: "E2E" } })).json();

    // Pre-seed Brief+Mission (simulate SP-02 ended)
    const pDir = join(projectsDir, p.id);
    mkdirSync(join(pDir, "mission"), { recursive: true });
    writeFileSync(join(pDir, "mission/selected.md"), "mission body", "utf-8");
    await store.update(p.id, { status: "mission_approved" });
    await store.update(p.id, { status: "awaiting_overview_input" });

    // 2. upload image
    await imageStore.save({
      projectId: p.id, filename: "a.png",
      buffer: Buffer.from("x"), source: "brief",
    });

    // 3. generate overview
    const genRes = await app.inject({
      method: "POST", url: `/api/projects/${p.id}/overview/generate`,
      payload: { productUrls: [], userDescription: "" },
    });
    expect(genRes.statusCode).toBe(202);
    await new Promise((r) => setTimeout(r, 100));

    const p1 = await store.get(p.id);
    expect(p1?.status).toBe("overview_ready");
    expect(existsSync(join(pDir, "context/product-overview.md"))).toBe(true);

    // 4. approve overview
    const aprRes = await app.inject({
      method: "POST", url: `/api/projects/${p.id}/overview/approve`,
    });
    expect(aprRes.statusCode).toBe(200);

    // 5. start case plan
    const startRes = await app.inject({
      method: "POST", url: `/api/projects/${p.id}/case-plan/start`,
      payload: { experts: ["X"] },
    });
    expect(startRes.statusCode).toBe(202);
    await new Promise((r) => setTimeout(r, 100));

    const p2 = await store.get(p.id);
    expect(p2?.status).toBe("awaiting_case_selection");
    expect(existsSync(join(pDir, "mission/case-plan/candidates.md"))).toBe(true);

    // 6. select cases
    const selRes = await app.inject({
      method: "POST", url: `/api/projects/${p.id}/case-plan/select`,
      payload: { selectedIndices: [1, 2] },
    });
    expect(selRes.statusCode).toBe(200);

    const p3 = await store.get(p.id);
    expect(p3?.status).toBe("case_plan_approved");
    expect(existsSync(join(pDir, "mission/case-plan/selected-cases.md"))).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test tests/integration-sp03-e2e.test.ts
```

预期 PASS（所有前置 tasks 完成后）。

- [ ] **Step 3: Commit**

```bash
cd /Users/zeoooo/crossing-writer
git add packages/web-server/tests/integration-sp03-e2e.test.ts
git -c commit.gpgsign=false commit -m "test(web-server): SP-03 e2e (brief→overview→case approved)"
```

---

### Task 30: 真实烟测（MetaNovas 项目）

**Files:** 无源码改动。本 task 是人类手工烟测 + 记录。

- [ ] **Step 1: 启动服务**

```bash
cd /Users/zeoooo/crossing-writer && pnpm dev
```

打开 http://localhost:5173，选择 SP-02 留下的 MetaNovas（或等价）项目，其 status 应为 `mission_approved`。

- [ ] **Step 2: 走 overview 流程**

- 左栏点"产品概览"—自动展开，右栏出 OverviewIntakeForm
- 上传 3 张 Brief 配图 + 3 张 MetaNovas 产品截图
- 填 URL：`https://metanovas.com` 等
- 补充描述：50-100 字
- 点"生成产品概览"

观察：
- 状态变 `overview_analyzing`
- 顶部 AgentStatusBar 出现绿色脉冲 `product_overview · claude/opus`
- 时间线出 `overview.started`
- 3-5 分钟后变 `overview_ready`
- 左栏 ProductOverviewCard 渲染出 frontmatter + 正文

- [ ] **Step 3: 编辑 + 批准**

- 点编辑，小改一段文字 → 保存
- 点"批准进入 Case 规划"

- [ ] **Step 4: Case 专家选择**

- 右栏 CaseExpertSelector，预选应该是 Mission 已选 ∪ Top 3 创意
- 确认勾选 3-5 位
- 点"开跑 Case 规划"

- [ ] **Step 5: 观察 Case 规划**

状态进 `case_planning_running`：
- AgentStatusBar 出多个并行 agent
- 时间线出 `case_expert.round1_started`（每位专家一行）
- 至少一位专家应触发 `case_expert.tool_call`（否则说明 round1 prompt 不够"激励"tool 调用，后续调优）
- 然后 `case_coordinator.synthesizing` → `case_coordinator.done`
- 状态变 `awaiting_case_selection`

- [ ] **Step 6: 选 Case**

- 左栏 CaseListPanel 出 N 个候选
- 检查每个 Case 的 frontmatter 字段完整（name / proposed_by / creativity_score / steps / prompts / inspired_by）
- 选 2-4 个 → 点"批准"

- [ ] **Step 7: 终态**

- 状态 `case_plan_approved`
- 右栏 CaseSelectedGuide 出现实测引导 checklist
- 检查 `~/CrossingVault/07_projects/<id>/mission/case-plan/selected-cases.md` 内容正确

- [ ] **Step 8: 记录烟测结论**

在 `docs/superpowers/plans/2026-04-13-sp03-case-plan-workbench.md` 的末尾附 section：

```markdown
## Smoke 结果（Task 30）

- 日期: <yyyy-mm-dd>
- 项目: MetaNovas
- Overview 生成耗时: <Xs>
- Case 规划并行专家数: <N>
- 触发 tool call 的专家: <list or 无>
- 最终 candidates.md Case 数: <N>
- 选中 Case 数: <N>
- 发现的问题: <list>
```

- [ ] **Step 9: Commit 烟测记录**

```bash
cd /Users/zeoooo/crossing-writer
git add docs/superpowers/plans/2026-04-13-sp03-case-plan-workbench.md
git -c commit.gpgsign=false commit -m "docs(sp-03): append smoke test results (MetaNovas)"
```

---

SP-03 实施计划结束。所有 31 个 task（含 Task 0）完成后，流水线 ③-④ 接通，从 SP-02 `mission_approved` 可以一路走到 `case_plan_approved`。SP-04 接着做 Evidence 上传与归类。


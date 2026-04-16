# Brief Analyst Vision + Dimension Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Brief Analyst so it truly reads uploaded images (not OCR hallucination) and reshape its output schema to better serve downstream Crossing-style writing.

**Architecture:** 四处改动并行执行：(1) model-adapter 给 Claude CLI 开 Read tool 让 `@path` 真正走视觉；(2) BriefIntakeForm 图片 tab 把 imageFiles 合成 markdown 统一走 `uploadBriefText`；(3) brief-analyst.md 重写 frontmatter schema（砍 audience/tone.forbidden_words，加 competitors/demo_hooks/reference_articles 等）+ 加视觉能力声明；(4) 三个 writer prompt 烧入十字路口三条风格红线。

**Tech Stack:** TypeScript, React 18, Fastify, vitest, @testing-library/react, better-sqlite3（不涉及）, claude/codex CLI

**Reference spec:** `docs/superpowers/specs/2026-04-16-brief-analyst-vision-design.md`

---

## File Structure

**Modified:**
- `packages/agents/src/model-adapter.ts` — Claude 分支 `--tools` flag 依据 images 存在性切换
- `packages/agents/tests/model-adapter.test.ts` — 新增 2 个测试
- `packages/web-ui/src/components/right/BriefIntakeForm.tsx` — `submit()` 图片 tab 分支重写
- `packages/agents/src/prompts/brief-analyst.md` — 整文件结构化重写
- `packages/agents/src/prompts/writer-opening.md` — 开头加风格红线 section
- `packages/agents/src/prompts/writer-practice.md` — 同上
- `packages/agents/src/prompts/writer-closing.md` — 同上

**Created:** 无

**Tests touched:** 只有 model-adapter.test.ts 新增 case；其余文件修改后跑全量测试确保不回归。

---

## Task 1: Adapter — Claude Read Tool 条件开启

**Files:**
- Modify: `packages/agents/src/model-adapter.ts:120-125`
- Test: `packages/agents/tests/model-adapter.test.ts`

**Context:** 当前 Claude 分支 args 固定 `"--tools", ""`（全关）。这导致 prompt 里的 `@/abs/path/img.png` 引用无法触发 Read，模型看不到图片像素，只看到路径字符串。修复：当 `images.length > 0` 时改为 `"--tools", "Read"`。无图场景保持 `""` 不变，防止 agent 乱跑。

- [ ] **Step 1.1: 先写失败测试（claude + images → --tools Read）**

在 `packages/agents/tests/model-adapter.test.ts` 末尾的 `describe("invokeAgent with images", ...)` block 内追加：

```ts
it("passes --tools Read when claude cli has images", async () => {
  vi.mocked(spawn).mockImplementation(mockChild({ status: 0, stdout: "ok" }));

  await invokeAgent({
    agentKey: "brief_analyst",
    cli: "claude",
    systemPrompt: "s",
    userMessage: "u",
    images: ["/abs/a.png"],
  });

  const call = vi.mocked(spawn).mock.calls[0]!;
  const args = call[1] as string[];
  const toolsIdx = args.indexOf("--tools");
  expect(toolsIdx).toBeGreaterThanOrEqual(0);
  expect(args[toolsIdx + 1]).toBe("Read");
});

it("keeps --tools empty when claude cli has no images", async () => {
  vi.mocked(spawn).mockImplementation(mockChild({ status: 0, stdout: "ok" }));

  await invokeAgent({
    agentKey: "x",
    cli: "claude",
    systemPrompt: "s",
    userMessage: "u",
  });

  const call = vi.mocked(spawn).mock.calls[0]!;
  const args = call[1] as string[];
  const toolsIdx = args.indexOf("--tools");
  expect(toolsIdx).toBeGreaterThanOrEqual(0);
  expect(args[toolsIdx + 1]).toBe("");
});
```

- [ ] **Step 1.2: 跑测试确认失败**

Run:
```bash
cd packages/agents && pnpm exec vitest run model-adapter --reporter=basic
```
Expected: 新增 2 个 test 中 "passes --tools Read when claude cli has images" 失败（当前 args 固定为 `""`）。第 2 个已经通过。

- [ ] **Step 1.3: 实现最小改动**

修改 `packages/agents/src/model-adapter.ts:120-125`：

```ts
  const args = [
    "-p", "-",
    "--tools", images.length > 0 ? "Read" : "",
    ...addDirArgs,
    ...(opts.model ? ["--model", opts.model] : []),
  ];
```

（原代码 `"--tools", "",` 改为 `"--tools", images.length > 0 ? "Read" : "",`）

- [ ] **Step 1.4: 跑测试确认通过**

Run:
```bash
cd packages/agents && pnpm exec vitest run model-adapter --reporter=basic
```
Expected: 全 PASS（包含原有 7 个 + 新增 2 个）。

- [ ] **Step 1.5: 跑 agents 包全量测试确认无回归**

Run:
```bash
cd packages/agents && pnpm exec vitest run --reporter=basic
```
Expected: 全 PASS。

- [ ] **Step 1.6: Commit**

```bash
git add packages/agents/src/model-adapter.ts packages/agents/tests/model-adapter.test.ts
git commit -m "fix(agents): enable Read tool for Claude when images present so vision actually works"
```

---

## Task 2: BriefIntakeForm — 图片 Tab Submit 归一

**Files:**
- Modify: `packages/web-ui/src/components/right/BriefIntakeForm.tsx:134-150`（`submit()` 函数）
- Test: `packages/web-ui/src/components/right/__tests__/BriefIntakeForm.test.tsx`（现存测试引用了不存在的 testId `brief-image-button` / `brief-file-button`，这些是历史遗留失败，不在本 task 修复范围；Task 2 只加新 test case 而不清理已坏 case）

**Context:** 当前 `submit()` 里 `mode === "image"` 走 `files` 分支，但图片 tab 用的 state 是 `imageFiles`，导致点"提交并解析"直接抛"请选择文件"错。修复：图片 tab 的 submit 把 `imageFiles` 拼成 `![filename](images/xxx.png)\n\n...` markdown 文本，走 `api.uploadBriefText({ text })`，与文字 tab 同路径。

**注意：** `imageFiles` 项在上传时已经由 `uploadBriefAttachment` 落盘到 `brief/images/`，每项的 `url` 字段是相对路径如 `images/abc.png`。合成时直接用 `![${filename}](${url})`，和文字 tab 里 contentEditable 产出的格式完全一致，后端正则无需改。

- [ ] **Step 2.1: 写失败测试**

在 `packages/web-ui/src/components/right/__tests__/BriefIntakeForm.test.tsx` 末尾追加：

```tsx
it("submits image-tab imageFiles as markdown text via uploadBriefText", async () => {
  // Mock uploadBriefAttachment then the final brief POST
  const fetchMock = vi.fn()
    // First call: uploadBriefAttachment (via fileInput change)
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ items: [{ kind: "image", url: "images/a.png", filename: "a.png", size: 1, mime: "image/png" }] }),
      text: async () => "",
    })
    // Second call: uploadBriefAttachment (via second fileInput change)
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ items: [{ kind: "image", url: "images/b.png", filename: "b.png", size: 1, mime: "image/png" }] }),
      text: async () => "",
    })
    // Third call: final submit → api.uploadBriefText
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => "",
    });
  (globalThis as any).fetch = fetchMock;

  const onUploaded = vi.fn();
  render(<BriefIntakeForm projectId="p1" onUploaded={onUploaded} />);

  // Switch to 图片 tab
  const imgTabBtn = screen.getByRole("button", { name: /图片/ });
  await userEvent.click(imgTabBtn);

  // Upload 2 images via hidden input
  // (The imageTabInputRef input is rendered inside the image drop zone)
  const fileInput = document.querySelector('input[type="file"][accept="image/*"]') as HTMLInputElement;
  const f1 = new File([new Uint8Array([1])], "a.png", { type: "image/png" });
  const f2 = new File([new Uint8Array([2])], "b.png", { type: "image/png" });
  await act(async () => {
    fireEvent.change(fileInput, { target: { files: [f1] } });
    await new Promise((r) => setTimeout(r, 0));
  });
  await act(async () => {
    fireEvent.change(fileInput, { target: { files: [f2] } });
    await new Promise((r) => setTimeout(r, 0));
  });

  // Click submit
  const submitBtn = screen.getByRole("button", { name: /提交并解析/ });
  await act(async () => {
    await userEvent.click(submitBtn);
  });

  // Last fetch call should be a brief text POST with markdown containing both image refs
  const lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  const [url, init] = lastCall;
  expect(String(url)).toMatch(/\/api\/projects\/p1\/brief$/);
  expect(init.method).toBe("POST");
  const body = JSON.parse(init.body);
  expect(body.text).toContain("![a.png](images/a.png)");
  expect(body.text).toContain("![b.png](images/b.png)");
  expect(onUploaded).toHaveBeenCalled();
});
```

- [ ] **Step 2.2: 跑测试确认失败**

Run:
```bash
cd packages/web-ui && pnpm exec vitest run BriefIntakeForm --reporter=basic
```
Expected: 新增 case 失败（当前 submit 抛"请选择文件"，或者根本没走到 uploadBriefText）。

- [ ] **Step 2.3: 实现 submit 改造**

修改 `packages/web-ui/src/components/right/BriefIntakeForm.tsx` 的 `submit()` 函数：

```ts
  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      if (mode === "text") {
        if (!text.trim()) throw new Error("简报文本不能为空");
        await api.uploadBriefText(projectId, { text });
      } else if (mode === "image") {
        if (imageFiles.length === 0) throw new Error("请选择图片");
        const md = imageFiles
          .map((it) => `![${it.filename}](${it.url})`)
          .join("\n\n");
        await api.uploadBriefText(projectId, { text: md });
      } else {
        // mode === "file": docx/pdf/md/txt 走多文件上传
        if (files.length === 0) throw new Error("请选择文件");
        for (const f of files) {
          await api.uploadBriefFile(projectId, f, {});
        }
      }
      onUploaded();
    } catch (e: any) { setErr(String(e.message ?? e)); }
    finally { setBusy(false); }
  }
```

- [ ] **Step 2.4: 跑测试确认通过**

Run:
```bash
cd packages/web-ui && pnpm exec vitest run BriefIntakeForm --reporter=basic
```
Expected: 新增 case PASS。

（历史遗留失败测试可能仍 FAIL，那是 Task 外范围。仅确认新 case PASS。）

- [ ] **Step 2.5: Commit**

```bash
git add packages/web-ui/src/components/right/BriefIntakeForm.tsx packages/web-ui/src/components/right/__tests__/BriefIntakeForm.test.tsx
git commit -m "feat(web-ui): unify image-tab submit through uploadBriefText so vision pipeline picks up all images"
```

---

## Task 3: Brief Analyst Prompt — 视觉能力 + 新 Schema

**Files:**
- Modify: `packages/agents/src/prompts/brief-analyst.md`（整文件替换）
- Tests: `packages/agents/tests/brief-analyst.test.ts`（若存在 snapshot 需 refresh；否则不动）、`packages/web-server/tests/brief-analyzer-service.test.ts`（期望结构可能需要同步）

**Context:** 重写 prompt 以实现 spec 中的 C1（视觉声明）+ C2/C3（新字段清单）。

- [ ] **Step 3.1: 先看现有依赖测试**

Run:
```bash
grep -rn "audience\|forbidden_words\|style_reference" packages/agents/tests packages/web-server/tests 2>&1 | head
```

记录所有会被影响的测试。若测试 hardcode 了旧 schema 字段（例如断言 output 含 `audience:`），这些测试在 Task 3 之后必须同步更新或被容忍。

- [ ] **Step 3.2: 整文件替换 brief-analyst.md**

Write: `packages/agents/src/prompts/brief-analyst.md`

```md
你是 Crossing Writer 系统的 Brief Analyst Agent。读甲方 Brief 原文（可能为纯文字、纯图片、或图文混合），输出一份严格结构化的 brief-summary.md。

# 输入形态说明

brief 可能引用图片（markdown 中的 `![](images/xxx.png)` 或直接作为附加图片）。无论哪种形态：
- 你具备完整的视觉能力，**直接读取**每一张图片内容（文字、图表数据、排版调性、视觉意图）
- 把图片内容当作 brief 正文的一部分来抽取信息
- **禁止**声明"OCR 不可用 / 需要外部工具 / 无法解析图片 / 请提供文字版"
- **不因** brief 以图片形式给出 **降低** `confidence`。`confidence` 只反映信息完整度，不反映载体形式。

# 硬性要求

输出**必须**是一个合法的 YAML frontmatter + markdown 正文的 md 文档，不要任何额外 markdown 代码围栏，不要任何注释或说明。

frontmatter 字段见下面模板，不能漏，不能多，必填字段若信息缺失填 `null`。

`key_messages` / `value_props` / `demo_hooks` / `must_cover_points` / `forbidden_claims` / `avoid_angles` 六个数组字段**必须按甲方最在意的优先级从高到低排序**——第一条就是甲方最想强调 / 最在意的那一条。

# 输出模板

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

competitors:
  - "..."
category_positioning: <产品在赛道里的坐标描述，一句话>

key_messages:
  - "..."
value_props:
  - "..."
demo_hooks:
  - "..."
must_cover_points:
  - "..."
forbidden_claims:
  - "..."
avoid_angles:
  - "..."

tone:
  voice: <语气关键词>
  preferred_words: ["..."]
reference_articles:
  - url: <str>
    why_referenced: <为什么参考这篇>
reference_tone_keywords: ["..."]

required_deliverables:
  - format: <wechat_article | x_thread | video_script | ...>
    word_count_range: [min, max]
    with_images: <true | false>
deadline: <YYYY-MM-DD or null>
deadline_strictness: <soft | hard>

gap_notes:
  - field: <哪个字段 / 哪方面信息>
    missing: <缺了什么>
    suggest_ask: <建议以什么问题问甲方>
confidence: <0-1 浮点>
---

# Brief 摘要

<300 字段落式自然语言总结，覆盖客户、产品、传播目的、赛道坐标、关键信息、禁区、语气、参考对标、交付。>

## 原始 Brief 关键片段

> <引用 3-5 段 brief 里最关键的原文；若 brief 是图片，引用你从图中抽出的最关键文字段落。>

## Brief Analyst 的判断

<1-2 段对这个 brief 的独立评估：传播难度、潜在陷阱、建议优先探索的 demo 角度。>

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

- [ ] **Step 3.3: 跑相关测试看有无断言冲突**

Run:
```bash
cd packages/agents && pnpm exec vitest run brief-analyst --reporter=basic
cd ../web-server && pnpm exec vitest run brief-analyzer-service --reporter=basic
```

若有测试 hardcode 了旧字段（`audience`、`forbidden_words`、`style_reference`），将断言改为新字段。若只是 smoke test（构造 prompt、判断调用次数等），不用动。

**如果测试仍通过**：跳到 Step 3.5。

**如果测试失败**：继续 Step 3.4。

- [ ] **Step 3.4: 同步更新 snapshot / 断言**

对每个失败测试：
- 若是 snapshot：`pnpm exec vitest -u <test-name>` 更新
- 若是显式断言（如 `expect(prompt).toContain("audience:")`）：改为对应新字段

重跑测试直到 PASS。

- [ ] **Step 3.5: Commit**

```bash
git add packages/agents/src/prompts/brief-analyst.md packages/agents/tests/brief-analyst.test.ts packages/web-server/tests/brief-analyzer-service.test.ts
git commit -m "feat(agents): rewrite brief-analyst prompt — vision capability + new schema (no audience, +competitors/demo_hooks/reference_articles, structured gap_notes)"
```

---

## Task 4: Writer Prompts — 烧入十字路口风格红线

**Files:**
- Modify: `packages/agents/src/prompts/writer-opening.md`
- Modify: `packages/agents/src/prompts/writer-practice.md`
- Modify: `packages/agents/src/prompts/writer-closing.md`

**Context:** 三条硬规则（禁"不是 X 而是 Y"、禁 `-`/`--` 破折号、必须短段落 + 空行）是系统级风格约束，不从 brief 抽取。在每个 writer prompt 靠前位置追加一个固定 section。三个文件追加**完全相同**的内容，不抽公共文件（先 YAGNI）。

- [ ] **Step 4.1: 读取 writer-opening.md 确认插入位置**

Run:
```bash
head -30 packages/agents/src/prompts/writer-opening.md
```

找到第一行 `你是"十字路口开头写作师"...` 后、`## 风格要求` 前插入新 section。

- [ ] **Step 4.2: 在 writer-opening.md 首行之后插入风格红线**

用 Edit 工具在 writer-opening.md 中：
- 定位原文：`## 风格要求`
- 替换为（在其前面插入）：

```md
## 十字路口风格红线（硬约束，违反即重写）

1. **禁用「不是 X，而是 Y」句式** —— 这类 AI 味的对比转折不要
2. **禁用 `-` / `--` 作为解释破折号** —— 用正常标点和短句代替
3. **必须使用"短段落 + 段落空行"排版**：
   - 一个段落 1-3 句，不要塞多个论点
   - 段落之间必须留空行
   - 这是十字路口的招牌节奏

## 风格要求
```

- [ ] **Step 4.3: 同样改 writer-practice.md**

对 `packages/agents/src/prompts/writer-practice.md` 执行同样的插入——在其现有的"## 风格要求"（或类似 section heading）前加同一段"## 十字路口风格红线"内容。若文件没有"## 风格要求"，插在系统 preamble 之后、prompt 主体前。

Run 确认：
```bash
grep -A 5 "十字路口风格红线" packages/agents/src/prompts/writer-practice.md
```
Expected: 显示三条硬规则。

- [ ] **Step 4.4: 同样改 writer-closing.md**

对 `packages/agents/src/prompts/writer-closing.md` 重复 Step 4.3 的改动。

- [ ] **Step 4.5: 确认 3 个文件都含新 section**

Run:
```bash
grep -l "十字路口风格红线" packages/agents/src/prompts/writer-*.md
```
Expected: 输出 3 个文件路径。

- [ ] **Step 4.6: 跑 writer 相关测试确认无回归**

Run:
```bash
cd packages/agents && pnpm exec vitest run writer --reporter=basic
```
Expected: 全 PASS（新 section 是纯 prompt 文本追加，不改变代码行为，应该不影响现有测试）。

- [ ] **Step 4.7: Commit**

```bash
git add packages/agents/src/prompts/writer-opening.md packages/agents/src/prompts/writer-practice.md packages/agents/src/prompts/writer-closing.md
git commit -m "feat(agents): bake Crossing style red lines into writer prompts (ban 'not X but Y', ban dashes, require short-paragraph rhythm)"
```

---

## Task 5: 端到端验收（手动）

**Files:** 无代码改动。仅验证。

**Context:** 四处代码改动完成后，做一轮端到端跑通检查，对齐 spec 验收点。

- [ ] **Step 5.1: 启动 dev 服务**

Run（分别在两个终端或 background）：
```bash
cd packages/web-server && pnpm dev
cd packages/web-ui && pnpm dev
```

- [ ] **Step 5.2: 走一遍纯图片 brief 路径**

1. 浏览器打开 http://localhost:3000
2. 新建一个项目
3. 进入 brief 上传页，切到"图片" tab
4. 拖入 2-3 张带文字的截图（如营销物料、PPT 页）
5. 点"提交并解析"
6. **Expected：** 不再报"请选择文件"；进入 `brief_analyzing` 状态
7. 等待 analysis 完成
8. 读取输出 `brief/brief-summary.md`

**验收：**
- ✅ 不出现"OCR 不可用"字样
- ✅ frontmatter 匹配新 schema：无 `audience:`、无 `tone.forbidden_words`、有 `competitors:`、`category_positioning:`、`demo_hooks:`、`reference_articles:`、`reference_tone_keywords:`、`gap_notes` 为 `[{field, missing, suggest_ask}]`
- ✅ `confidence` 基于实际内容完整度（不因图片形式被惩罚）

- [ ] **Step 5.3: 走一遍文字 + 内嵌图片 brief 路径**

1. 新项目，进入 brief 上传
2. 在"文字" tab 里粘贴一段文案 + Cmd+V 粘贴 2 张截图
3. 点"提交并解析"
4. **Expected：** 提交成功，analysis 能读到内嵌图片内容

**验收：** 同 5.2。

- [ ] **Step 5.4: （可选）跑一次完整 writer 流程对比风格**

如果想验证 Task 4 效果，可以继续推进项目到 writer 阶段，确认产出文章：
- ✅ 无「不是 X，而是 Y」句式
- ✅ 无 `-` / `--` 破折号
- ✅ 段落短、段间有空行

- [ ] **Step 5.5: 跑全量测试确保无回归**

Run:
```bash
cd /Users/zeoooo/crossing-writer && pnpm -r test --run 2>&1 | tail -30
```
Expected: 全 PASS。如有本 plan 无关的既有失败（例如 BriefIntakeForm 里遗留的 `brief-image-button` testId 失败），记录但不阻塞验收。

- [ ] **Step 5.6: 标记验收完成（无 commit，纯记录）**

在 plan 文件对应 step 打勾，把验收结果（手动观察）贴到 plan 注释区或跟用户同步。

---

## Self-Review 结果

**Spec 覆盖：**
- ✅ 改动 A（Adapter Read）→ Task 1
- ✅ 改动 B（UI 归一）→ Task 2
- ✅ 改动 C（Prompt 重构）→ Task 3
- ✅ 改动 D（Writer 风格红线）→ Task 4
- ✅ 验收点 → Task 5

**Placeholder 扫描：** 无 TBD / TODO / "similar to..." / 空 error handling。

**类型一致性：** `imageFiles` 项使用 `it.filename` + `it.url`（见 BriefAttachmentItem type）；`uploadBriefText` 已经是 api.ts 里的现有函数；所有字段名在 Task 2 的 submit 代码和测试里一致。

**风险：**
- BriefIntakeForm.test.tsx 里已有若干引用过时 testId（`brief-image-button` 等）的测试，那是 Task 外的既有问题。Task 2 只确保新 case PASS，不清理历史遗留。

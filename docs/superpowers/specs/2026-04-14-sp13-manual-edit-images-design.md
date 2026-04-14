# SP-13 Manual Edit + Image Insertion — Design Spec

**日期**: 2026-04-14
**状态**: Draft
**依赖**: SP-05 (Writer), SP-09 (Selection Rewrite)

---

## 1. 动机

SP-05 让 writer agent 输出 markdown 段落，SP-09 让用户选中局部文字由 agent 重写。但当前 `ArticleSection.tsx` 只通过 `ReactMarkdown` 渲染视图，**用户没有任何人工编辑入口**：

- 错别字、标点要靠再跑一次 agent 修
- 想加一句补充说明、改个措辞 — 没办法
- 原创素材图（采访现场、截图、手绘）无处插入
- SP-09 选区重写是"让 agent 改"，缺少"人工自己改"的对位

SP-13 补齐这块：每个段落卡片可切换到 markdown 编辑态，支持拖拽 / 按钮上传插图，保存后回到视图态。SP-09 保留，两种交互互补。

---

## 2. 核心概念

- **`SectionEditorMode`**: `"render" | "edit"`，每个 `ArticleSection` 实例各自维护
- **Toggle**: section header 增加按钮 `✏️ 编辑` ↔ `👁 预览`
- **Image upload**: 图片走后端 `POST /api/projects/:id/images`，返回 `{url}`；编辑器在 caret 处插入 `![alt](url)` markdown
- **Manual flag**: 保存时 section frontmatter 打 `manually_edited: true` + 追加 `edit_history[]` 条目，让 agent 下次路过时知道此段被人工改过（用于决定是否保留）

---

## 3. 架构

### 3.1 Frontend

```
ArticleSection.tsx (已有)
├── mode: "render" | "edit"  (新增 useState)
├── render 模式: ReactMarkdown + SelectionBubble (SP-09，保留)
└── edit 模式: <ArticleSectionEditor>   (新增)
               └── wrapped by <ImageUploadDropzone>  (新增 HOC)
```

- **`ArticleSectionEditor.tsx`** (新建)
  - Props: `{ initialBody, frontmatter, onSave(body), onCancel, disabled }`
  - 内部: controlled `<textarea>` (markdown source) + 可选右侧 live preview (split view) 或仅 textarea
  - Toolbar: `[📷 插图]` `[保存]` `[取消]`
  - `[📷 插图]` 打开原生 `<input type="file" accept="image/*">`，上传后在 caret 处插入 markdown
  - Caret 插入工具: 维护 `textareaRef.selectionStart`，用 `value.slice(0, pos) + insert + value.slice(pos)` 更新

- **`ImageUploadDropzone.tsx`** (新建，HOC)
  - 监听 `dragenter/dragover/dragleave/drop` 事件
  - `dragover` 时显示半透明 overlay: `拖到这里上传`
  - `drop`: 取 `e.dataTransfer.files`，过滤 `image/*`，逐个调用 `uploadImage(projectId, file)`，成功后在 caret 处插入 `![<filename>](<url>)\n`
  - 上传中显示 spinner；失败 toast 错误

- **`writer-client.ts`** (扩展)
  - 新增 `uploadImage(projectId, file) -> Promise<{ url, filename }>`
  - 现有 `putSection(projectId, key, { body, frontmatter })` 用于保存 (已在 SP-05；若不存在则本 spec 需一并补上)

### 3.2 Backend

- **新路由** `POST /api/projects/:id/images`
  - `multipart/form-data`，field name `file`
  - Content-Type 校验: `image/png | image/jpeg | image/webp | image/gif`，其他拒绝 `415`
  - Size 限制: `10 MB`，超出 `413`
  - 文件 hash: `sha256(bytes).slice(0, 16)` + 原扩展名 → `<hash>.<ext>`
  - 存储: `07_projects/<project_id>/images/<hash>.<ext>`
  - 去重: 若同 hash 文件已存在，直接返回现有 URL
  - 返回: `{ url: "/api/projects/:id/images/<hash>.<ext>", filename, size, mime }`

- **静态服务** `GET /api/projects/:id/images/:filename`
  - 读 `07_projects/<id>/images/<filename>`，200 + 正确 `Content-Type`
  - 404 if not found；路径 traversal 防护（`path.basename` + 正则白名单）

- **`writeSection` 调整** (若需)
  - 接收 `{ body, frontmatter }`；frontmatter merge 模式
  - 本 spec 不改磁盘格式，只新增 frontmatter 字段

---

## 4. UI 细节

### Render 模式 (默认)

```
┌─ §2. 背景 ──────────────── [✏️ 编辑] [🔄 重写] ┐
│  <ReactMarkdown>...</ReactMarkdown>             │
│  (SelectionBubble 浮现于选区，SP-09 入口)        │
└─────────────────────────────────────────────────┘
```

### Edit 模式

```
┌─ §2. 背景 ──────── [📷 插图] [💾 保存] [✖ 取消] ┐
│ ┌─ Source (textarea) ─────────────────────────┐ │
│ │ ## 背景                                      │ │
│ │ 2026 年 4 月……                               │ │
│ │ ![现场](/api/projects/p1/images/abc.png)     │ │
│ │ [caret]                                      │ │
│ └──────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

- MVP: 仅 textarea，不做 split preview（减少实现复杂度；用户保存后即见）
- 拖拽时整个 editor 区域覆盖半透明蓝色 overlay + 文字 `拖到这里上传`
- 上传中: overlay 变为 `上传中... 2/3`；完成后自动消失

---

## 5. 数据结构

### Section frontmatter (扩展)

```yaml
---
key: "02-background"
title: "背景"
manually_edited: true            # SP-13 新增
last_edited_at: "2026-04-14T10:30:00Z"  # SP-13 新增
edit_history:                    # SP-13 新增
  - { at: "2026-04-14T10:30:00Z", kind: "manual", summary: "+12 -3 chars, +1 image" }
  - { at: "2026-04-14T09:15:00Z", kind: "agent_rewrite_selection" }
images:                          # SP-13 新增 (派生，可选)
  - { url: "/api/projects/p1/images/abc.png", alt: "现场", inserted_at: "..." }
---
```

- `edit_history` 保留最近 20 条
- `images` 可在保存时从 body 提取 `![]()` 自动生成；或省略，由 agent 扫描 body 获取

---

## 6. API 细节

### `POST /api/projects/:id/images`

- Request: `multipart/form-data`, field `file`
- Success `200`:
  ```json
  { "url": "/api/projects/p1/images/abc123def456.png",
    "filename": "abc123def456.png", "size": 142384, "mime": "image/png" }
  ```
- Errors: `400` (no file), `413` (too large), `415` (bad mime), `500`

### `PUT /api/projects/:id/sections/:key` (复用/确认)

- Body: `{ body: string, frontmatter?: Partial<SectionFrontmatter> }`
- Server merge: frontmatter 浅合并，自动追加 `edit_history` + 打 `manually_edited: true`

---

## 7. 并发 / 互斥

- 每个 section 有 `agent_state`: `idle | rewriting | generating`
- 若 `agent_state !== idle`: `[✏️ 编辑]` 按钮 disabled，tooltip `agent 正在处理，请稍候`
- 反向: 用户处于 edit 模式时，agent 触发 SP-08/09 写入该 section → 前端弹 confirm `段落正在编辑中，agent 改动已排队，要放弃编辑吗？`
- 简化 MVP: 仅做前端 guard，不做服务端锁

---

## 8. 验收标准

- [ ] 点击 section 的 `✏️ 编辑` 按钮切换到 textarea，内容与 ReactMarkdown 渲染前 source 完全一致
- [ ] 编辑后点 `保存` 回到 render 模式，新内容正确渲染
- [ ] 点 `取消` 丢弃改动，回到原内容
- [ ] `[📷 插图]` 按钮打开文件选择器，上传后 markdown 在 caret 处插入 `![filename](url)`，preview 显示图片
- [ ] 拖拽图片到编辑区显示 overlay，drop 后上传并插入 markdown
- [ ] 多张图片 drop 依次插入，顺序稳定
- [ ] 非图片 mime 或 >10MB 被拒绝，toast 错误
- [ ] 保存后 section frontmatter 含 `manually_edited: true` 和一条 `edit_history` 记录
- [ ] Agent 正在 rewrite 同一 section 时，编辑按钮 disabled；SP-09 选区重写在 render 模式依然可用

---

## 9. 不在本 spec 范围

- 富文本 / WYSIWYG 编辑器（本 spec 只做 markdown source textarea）
- 多人协同编辑、OT/CRDT
- 版本回滚 UI（`edit_history` 仅记录，不提供 diff viewer）
- 图片裁剪 / 压缩 / CDN
- 跨 section 批量编辑
- Agent 感知 `manually_edited` 后的策略（留给后续 spec，本 spec 只写 flag）

---

## 10. 实现顺序建议

1. Backend `POST /images` + 静态路由 + 单测
2. `writer-client.ts` 加 `uploadImage`
3. `ArticleSectionEditor` 基础 textarea + 保存/取消
4. `ArticleSection` 接入 mode toggle
5. `ImageUploadDropzone` HOC + `[📷 插图]` 按钮
6. Frontmatter 字段 + `edit_history` 追加逻辑
7. 并发互斥 guard
8. E2E: 编辑保存、拖拽上传、按钮上传、与 SP-09 共存

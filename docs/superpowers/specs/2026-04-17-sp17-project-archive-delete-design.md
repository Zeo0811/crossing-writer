# SP-17 — Project Archive & Delete

**Status**: Design
**Date**: 2026-04-17
**Owner**: crossing-writer core

---

## 1. 动机

Vault 目录 `~/CrossingVault/07_projects/` 越来越乱：
- 早期测试项目、废弃草稿堆在列表首页；
- 已发布项目不想彻底删除，但也不想每次看到；
- 目前想清理只能退出 app、去文件管理器 `rm -rf <id>/`，风险高且非原子（web-server 可能仍持有缓存）。

SP-17 在 UI 引入 **归档**（软隐藏）与 **硬删**（不可恢复）两个操作，并提供清晰的二次确认避免误删。

---

## 2. 核心概念

- **ProjectStatus (location-based)**：
  - `active` → 存放于 `07_projects/<id>/`
  - `archived` → 存放于 `07_projects/_archive/<id>/`
- 归档 / 恢复 = 目录移动（`fs.rename`），无 schema 变更；
- 硬删 = `fs.rm(<dir>, { recursive: true, force: true })`，不可逆；
- `_archive/` 以下划线开头，`list()` 原逻辑会自动忽略（下划线目录视为元数据），活跃列表天然干净。

---

## 3. 架构

### 3.1 Backend: `ProjectStore`

文件：`packages/web-server/src/services/project-store.ts`

新增方法：

```ts
archiveDir(id: string): string        // join(this.root, "_archive", id)
isArchived(id: string): Promise<boolean>
archive(id: string): Promise<void>    // rename active → archive
restore(id: string): Promise<void>    // rename archive → active (冲突时报错)
destroy(id: string, opts: { confirmSlug: string }): Promise<void>
listArchived(): Promise<Project[]>    // 读 _archive/ 下所有 project.json
```

约束：
- `archive()` / `restore()` 若目标已存在同名目录 → 抛 `ProjectConflictError`（极少，但 slug 重复时可能）；
- `destroy()` 要求传入 `confirmSlug`，若与目录中 `project.json.slug` 不一致 → 抛 `ConfirmationMismatchError`；
- `destroy()` 在 active 与 archived 两个位置都尝试定位（用户可能直接从归档列表硬删）；
- `list()` 保持现状（只扫 `07_projects/` 直接子目录，跳过以 `_` 开头的目录）；新增 `listArchived()` 专扫 `_archive/`。

### 3.2 Routes (Fastify)

| Method | Path | Body | 作用 |
|---|---|---|---|
| POST | `/api/projects/:id/archive` | — | active → archived |
| POST | `/api/projects/:id/restore` | — | archived → active |
| DELETE | `/api/projects/:id` | `{ confirm: "<slug>" }` | 硬删（两种状态都可） |
| GET | `/api/projects` | query: `include_archived`, `only_archived` | 列表（见下）|

`GET /api/projects` 行为：
- 默认（无 query）：返回 active 列表，响应头 `X-Archived-Count: <M>`，或 body 结构 `{ items, archived_count }`；
- `?include_archived=1`：返回并集，每项带 `archived: boolean`；
- `?only_archived=1`：只返回归档项。

### 3.3 级联副作用

- `ArticleStore`、图片资源、evidence 等都存放在 `<projectDir>/...` 子目录下，`archive` 整体 rename 即可保留内部引用（相对路径）；
- 任何使用 **绝对路径** 保存的历史字段（`brief.raw_path` 等）在归档后将失效 —— 本 spec 接受该问题，因为归档项本来就不参与工作流；恢复时路径自动还原；
- `MissionStore`、`WriterRunStore` 等如果有内存级 LRU 缓存，需在 archive/restore/destroy 后 `invalidate(id)`。

---

## 4. Frontend

### 4.1 `ProjectList.tsx`

顶部新增 Tab 条：

```
[ 进行中 (12) ]  [ 已归档 (4) ]
```

- 默认 active tab = `进行中`；切换时分别请求 `GET /api/projects`（active）或 `GET /api/projects?only_archived=1`；
- Tab 数字徽章从响应里拿；active tab 的请求会同时返回 `archived_count` 用于另一个 tab 的计数。

### 4.2 Per-card 操作

**active card**（进行中 tab）：

```
... 卡片内容 ...
                              [⋯]
                               └── 归档
                                   硬删
```

**archived card**（已归档 tab）：

```
... 卡片内容（灰度，顶部标签 "已归档"）...
                  [恢复]  [硬删]
```

### 4.3 删除确认 Modal

```
┌──────────────────────────────┐
│  删除项目「<name>」？           │
│                              │
│  此操作不可恢复。项目目录        │
│  及其所有资产（简报/案例/图片/   │
│  稿件）将被永久删除。            │
│                              │
│  请输入项目 slug "<slug>"      │
│  确认删除：                    │
│  ┌────────────────────────┐  │
│  │                        │  │
│  └────────────────────────┘  │
│                              │
│       [ 取消 ]   [ 删除 ]     │ ← 删除按钮 disabled until 输入匹配
└──────────────────────────────┘
```

- 删除按钮样式：destructive red (`bg-red-600`)；
- 归档 / 恢复 **不** 需要确认 Modal，直接操作 + toast（可 Undo？本 spec 不做）。

---

## 5. API 契约

### 5.1 Archive

```
POST /api/projects/:id/archive
→ 200 { ok: true, id, archived_path: "_archive/<id>" }
→ 404 { error: "project_not_found" }
→ 409 { error: "already_archived" }
```

### 5.2 Restore

```
POST /api/projects/:id/restore
→ 200 { ok: true, id }
→ 404 { error: "project_not_found" }
→ 409 { error: "name_conflict", detail: "<id> already exists in active" }
```

### 5.3 Destroy

```
DELETE /api/projects/:id
Body: { confirm: "<slug>" }
→ 200 { ok: true, id, removed_path: "..." }
→ 400 { error: "confirmation_mismatch", expected: "<slug>" }
→ 404 { error: "project_not_found" }
```

### 5.4 List

```
GET /api/projects
→ 200 { items: Project[], archived_count: number }

GET /api/projects?only_archived=1
→ 200 { items: Project[], active_count: number }

GET /api/projects?include_archived=1
→ 200 { items: (Project & { archived: boolean })[] }
```

---

## 6. 数据结构

**无 schema 变更**。`ProjectStatus` 由目录位置推导，不写入 `project.json`。理由：
- 避免 status 字段与已有 `status: "created" | ...` (stage 流) 语义冲突；
- 归档是部署/存储关注点，不是项目生命周期状态；
- 移动目录即真相源，杜绝 JSON 与文件系统不一致。

---

## 7. 验收

- [ ] 点击 active 卡片 `⋯ → 归档`，卡片从进行中消失，已归档 tab 计数 +1，`07_projects/<id>/` 已移动至 `07_projects/_archive/<id>/`。
- [ ] 已归档 tab 点 `恢复`，项目回到 active；目录回到 `07_projects/<id>/`。
- [ ] 硬删 Modal 输入错误 slug，`删除` 按钮保持 disabled；输入正确后按下，目录实际被 `fs.rm`，列表刷新不再出现。
- [ ] 直接通过 API `DELETE /api/projects/:id` 传错误 `confirm` → 400，目录仍在。
- [ ] 两个 tab 的计数徽章与实际目录数一致（切换后 refetch 正确）。
- [ ] 归档后 `MissionStore` / `ArticleStore` 对该 id 的后续读写返回 404，不读到残影缓存。
- [ ] 恢复后 evidence / images / drafts 全部可访问（相对路径未断裂）。
- [ ] slug 冲突（罕见）场景：归档时 `_archive/<id>` 已存在 → 409，UI toast 提示冲突，不破坏任何数据。

---

## 8. 不在本 spec 范围

- 回收站 / undelete / 硬删冷却期；
- 批量归档 / 批量删除；
- 归档项自动过期清理（如 90 天后提示硬删）；
- 导出项目为 zip；
- 归档 / 删除的审计日志落盘（当前 web-server 日志覆盖即可）；
- 跨设备同步归档状态（vault 是单机文件系统）。

---

## 9. 实施顺序建议

1. `ProjectStore`: 加 archive/restore/destroy/listArchived + 单测；
2. Routes 4 个端点 + Fastify schema；
3. `ProjectList.tsx` Tab + 菜单；
4. 删除确认 Modal；
5. 级联：清理相邻 store 的 id 缓存；
6. 手动 QA 走一遍验收清单。

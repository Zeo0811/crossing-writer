# v1.5.0 Mock UI 设计标准（基于 Checkpoint 1-2 已确认）

本文档锁定后续 checkpoint（3-9）必须遵循的 UI 标准，避免每屏重复确认。

## 1. 顶部导航
- 单行 `rounded` 卡片：`py-3 px-[18px]`
- 左：`CROSSING.WRITER` (pixel) + `v1.5` (pixel) + 粉色 sprite
- 中：5 个 nav 链接（项目 / 知识库 / 风格 / 配置 / 设置），每个带像素 icon + 中文 label
- 右：`claude_ready` + `codex_ready` 双 chip（hover 弹详情卡） + 主题切换 ☾/☀
- 不要：⌘K 按钮（仍可键盘）、面包屑、sidebar

## 2. 页面外层
- 容器 `max-w-[1280px] mx-auto px-5 pt-7 pb-[72px] flex-col gap-7`
- 每个一级页面（ProjectList / Workbench / Knowledge / Config / Settings）外层一个 `rounded border border-hair bg-bg-1 overflow-hidden` 卡

## 3. Workbench 内部结构
```
┌─ rounded border bg-bg-1 ─────────────────┐
│ header  px-6 h-12 border-b               │   ← 项目名（左）+ ⋯（右）
│ phase   px-6 py-4                        │   ← 横排 6 phase chip + active 下方 4 条呼吸短线
│ main    px-6 py-5                        │   ← 当前阶段内容，**无 SectionTitle**
└──────────────────────────────────────────┘
```
- 不再有右侧 HelperPanel
- main 内不再有「STEP 01 / 上传 X」二级标题；phase chip 即标题
- 内容区直接进 tab（如有）或主控件

## 4. 颜色 / 字体
- **只用 CSS var**：`--bg-0/1/2`、`--accent`、`--accent-on`、`--meta`、`--faint`、`--hair`、`--red`、`--amber`、`--pink`
- 禁止硬编码 hex
- **像素字体仅用于**：logo 文字、`v1.5` 版本、phase chip 的 `01-06` 序号、空态点缀（如 PRESS START 已删）
- 其余全用 `--font-sans`（Inter + Noto Sans SC）

## 5. Phase Chip 标准（PhaseSteps 组件已锁定）
- 高度：`h-8`
- 间距：chip 之间 `gap-1.5`，中间用 `›` 分隔
- 内部：像素序号 + 中文 label + 状态修饰
- **3 态配色**：
  - `done` → `border-accent-soft bg-accent-fill text-accent` + ✓
  - `current` → `border-accent bg-accent text-accent-on font-semibold` + 闪烁内点 + 下方 4 条短线呼吸
  - `current + failed` → `border-red bg-red-fill text-red`
  - `todo` → `border-hair text-faint`
- 下方 4 条呼吸短线（`phaseTrailPulse` 1.6s ease-in-out，错峰 0/.15/.3/.45s）

## 6. 状态映射
- 6 phase：**需求解析 / 专家团选题 / 产品解析 / Case 建议 / 制作 Case / 创作**
- 28 个真实 status → phase 通过 `PHASES.matches[]` 映射（已对齐后端 state-machine）
- Workbench `renderPhase(status)` 按真实 status 切视图，不按 phase 切

## 7. 卡片 / 面板
- 顶级卡：`rounded border-hair bg-bg-1`
- 嵌套面板（在 bg-1 内）：`rounded bg-bg-2`，无 border
- 内 padding：默认 `p-[18px]`，紧凑 `p-4`

## 8. 表单控件
- input / textarea：`bg-bg-2 border border-hair rounded px-3 py-2 text-sm outline-none focus:border-accent-soft`
- field label：`text-xs text-meta block mb-1`
- fieldset legend：`px-2 text-xs text-meta`
- 多 tab 容器（如文字/文件/图片）：所有 mode 共用同一外壳 `bg-bg-2 border-hair rounded min-h-[260px]`

## 9. Tab（页内 mode 切换）
- 容器：`flex items-center gap-1 border-b border-hair`
- 单 tab：`px-4 py-2.5 text-sm border-b-2 -mb-px`
- active：`border-accent text-heading`
- inactive：`border-transparent text-meta hover:text-heading`

## 10. 按钮
- 主 CTA：`rounded border-accent-soft bg-accent text-accent-on font-semibold px-4 py-2 hover:shadow-[0_0_12px_var(--accent-dim)]`
- 次：`text-xs text-meta hover:text-heading` 或 `border-hair-strong text-meta`
- 危险：`bg-red text-white` 同尺寸
- 链接：`text-accent hover:underline`

## 11. 状态 chip（卡片标签）
- `text-[11px] px-2 py-0.5 rounded-sm font-medium`（无像素字、无 `_` 下划线）
- 配色由 `statusBadge(status)` 统一返回 `{ fg, bg, label }`

## 12. Modal
- 遮罩：`fixed inset-0 bg-[rgba(0,0,0,0.5)] backdrop-blur-sm`
- 卡：`w-[440px] max-w-90vw rounded border-hair-strong bg-bg-1 shadow-2xl`
- 三段：header (`px-4 py-3 border-b`) / body (`p-4`) / footer (`px-4 py-3 border-t` 按钮右对齐)
- header 只有 1 行标题（不要 pixel 副标 + sans 主标重复）

## 13. Toast
- 顶右浮，max 5，4s auto-dismiss
- 文案：**不带 emoji**
- success：「主体已 + 完成态」（项目已创建 / 简报解析完成）
- error：「主体 + 失败：简因」
- info：「正在 + 动词…」

## 14. 空态
- 大像素 art icon（`<PixelEmptyArt size={108}>`）
- 居中，`py-16`
- 主标 `text-xl text-heading` + 副标 `text-sm text-meta` + 主 CTA
- 不要 `PRESS START` 之类装饰

## 15. Mock 控制台
- 默认收起为右下 ⚙ 圆按钮
- 展开时给 hero 项目状态 select、CLI 状态切换、toast 演示
- 标题「演示控制台」（无 pixel）
- 不污染产品 UI

---

后续 checkpoint（3 专家团选题、4 产品解析、5 Case 建议、6 制作 Case、7 创作、8 配置区）按以上标准建造。每屏完成后用户验收。

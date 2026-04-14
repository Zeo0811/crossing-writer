# SP-14 Retro-Pixel Visual Redesign — Design Spec

- **Spec ID**: SP-14
- **Date**: 2026-04-14
- **Status**: Approved (v5 mockup signed off)
- **Mockup reference**: `/Users/zeoooo/Downloads/crossing-writer-vibe-mockup.html` (v5)

---

## 1. 动机

功能层 SP-05 ~ SP-13 已陆续落地（Writer、StyleDistiller、WikiIngestor、Tool Use、Selection Rewrite、ConfigWorkbench、CLI Health、Superpowers loop）但视觉层仍然是 vite + 部分手写 CSS 的灰白风：

- 首页、ProjectWorkbench、Writer、ConfigWorkbench 四个一级页面调性不统一：有的用 `#f5f5f5` 中性灰，有的直接 Tailwind default，辨识度低。
- 十字路口（Crossing）品牌本身是「半 terminal / 半数码人」的调性，当前 UI 完全不体现。
- 多处硬编码色值（`#2c8a5a`、`#0f0f10`、`rgb(218, 227, 217)` 等）散落，换主题、改配色成本高。
- 暗色模式缺失；长时间写作场景用户多次反馈「晚上太刺眼」。

本 spec 把整站一次性迁移到 **retro-pixel terminal** 视觉语言，深色默认 + 浅色可选，统一 design token，落地一套最小但完整的组件库。

## 2. 设计 Token 系统

所有 token 挂在 `:root`（默认 dark）与 `[data-theme="light"]` 两份 CSS variable 下，完整 hex 以 mockup v5 为准。组件层只引用 token 名，禁止写死 hex。

### 2.1 Dark（默认，带轻微绿底调）

| 类别 | Token | 值 |
| --- | --- | --- |
| 背景 | `--bg-0` | `#081208` |
| | `--bg-1` | `#0e180e` |
| | `--bg-2` | `#13211a` |
| 文字 | `--fg-heading` | `#e9f3ea` |
| | `--fg-body` | `#dae3d9` |
| | `--fg-meta` | `#8ea394` |
| | `--fg-faint` | `#5d6f63` |
| 强调 | `--accent` | `#40ff9f` |
| | `--accent-soft` | `#2dc27a` |
| | `--accent-dim` | `rgba(64,255,159,0.18)` |
| | `--accent-on` | `#04140a` |
| 语义 | `--amber` | `#ffc857` |
| | `--red` | `#ff6b6b` |
| | `--pink` | `#ff8bd5`（sprite 装饰） |
| 边线 | `--hair` | `rgba(218,227,217,0.12)` |
| | `--hair-strong` | `rgba(218,227,217,0.28)` |
| 日志/键帽 | `--log-bg` | `#05100a` |
| | `--kbd-bg` | `#14221a` |

### 2.2 Light（亮色、偏中性）

| 类别 | Token | 值 |
| --- | --- | --- |
| 背景 | `--bg-0` | `#f5f6f7` |
| | `--bg-1` | `#ffffff` |
| | `--bg-2` | `#eef1ee` |
| 文字 | `--fg-heading` | `#111418` |
| | `--fg-body` | `#1d2126` |
| | `--fg-meta` | `#5c6770` |
| | `--fg-faint` | `#8a949c` |
| 强调 | `--accent` | `#1f9e5c` |
| | `--accent-soft` | `#38bd77` |
| | `--accent-dim` | `rgba(31,158,92,0.14)` |
| | `--accent-on` | `#ffffff` |
| 语义 | `--amber` | `#c7811f` |
| | `--red` | `#c13838` |
| | `--pink` | `#c24b97` |
| 边线 | `--hair` | `rgba(17,20,24,0.1)` |
| | `--hair-strong` | `rgba(17,20,24,0.22)` |
| 日志/键帽 | `--log-bg` | `#eef1ee` |
| | `--kbd-bg` | `#e4e8e5` |

## 3. 字体系统

仅三类字体，按「装饰 / 正文 / 代码」分层，禁止在正文里混用 pixel 字：

- **Pixel**（`"Press Start 2P"`, `VT323`, monospace）
  - 仅用于：顶栏 Logo「CROSSING」字样、version/build tag（如 `v0.14.0`）、极少量状态 chip 的 4-6 字装饰（`READY` / `LIVE`）
  - 字号固定 11–13px，字距 +1px
- **Sans**（`Inter`, `"Noto Sans SC"`, system-ui）
  - Body、段落卡正文、按钮文字、表单 label、tab、面包屑
  - 中英文混排优先 Inter 前置，`Noto Sans SC` fallback，行高 1.55
- **Mono**（`"IBM Plex Mono"`, `ui-monospace`）
  - 代码块、段落卡的 meta 行（字数/时间戳）、CLI 日志、`<kbd>`、agent / tool 的 id 展示

全局 `html { font-family: var(--font-sans) }`；三个家族在 `src/styles/fonts.css` 定义 `@font-face` 或 import Google Fonts 子集。

## 4. 组件库改造清单

新增或改造位于 `src/components/ui/` 的基础组件。每个组件必须同时过 dark + light 两主题可视 review。

- **TopNav** — `h-12` 顶栏；左侧 pixel logo + 面包屑；右侧 health dot（绿/黄/红）+ `☾/☼` 主题按钮 + 账号按钮。底部一条 `--hair` 分割。
- **Card**（三变体）
  - `section` — 圆角 10px，`bg-1`，1px `--hair` 边
  - `agent` — 带左侧 2px `--accent` 装饰条
  - `panel` — `bg-2`，无边，用于嵌套
- **Button**
  - `primary` — 填充 `--accent`，文字 `--accent-on`，hover 提亮 8%
  - `secondary` — 透明底 + 1px `--hair-strong`，hover 背景变 `--accent-dim`
  - `ghost` — 无边无底，hover 文字变 `--accent`
- **Chip**（3 类）
  - `status`（含 dot + pixel 小字）
  - `kind`（agent / tool / style / wiki 标签）
  - `meta`（mono 字体，展示数量/时间）
- **Dropdown / Select / Input / Checkbox**
  - 统一 `bg-2` + 1px `--hair`；focus 外框 `--accent`，hover 加 `0 0 0 2px var(--accent-dim)` glow
  - `Checkbox` 选中态用 pixel 风 √（8×8 方块勾）
- **ProgressBar** — 高 4px，轨 `--hair`，填充 `--accent`；右侧 mono `42%`
- **Modal** — 遮罩 `rgba(0,0,0,0.55)` + `backdrop-filter: blur(6px)`；容器 `bg-1` + `--hair`
- **Pixel Icon Set**（16×16 / 24×24 SVG，线性描边 = 1 像素方块）：`agent`, `tool`, `style`, `wiki`, `raw`, `config`, `distill`, `health-dot`

## 5. 全站页面 restyle 清单

按落地顺序：

1. **首页 ProjectList** (`src/pages/ProjectList.tsx`) — 列表卡换 section Card、状态 chip、空态 pixel 插画占位
2. **ProjectWorkbench** (`src/pages/ProjectWorkbench.tsx`) — 三栏布局保持，侧栏导航 hover 色、tab 下划线改 `--accent`
3. **Writer** (`src/pages/Writer.tsx`)
   - 段落卡：`bg-1` + 悬浮时 `--accent` 细边
   - `SelectionBubble`：浮层用 `bg-2` + pixel 风分隔符
   - `InlineComposer`：输入区换 Input 组件 token；"发送" 按钮 primary
4. **ConfigWorkbench** (`src/pages/ConfigWorkbench.tsx`) — agent / tool / style / wiki 四列全改 Card(agent) + Chip(kind)
5. **风格面板独立页** `StylePanels`、wiki 独立页 — 列表 + 详情双栏统一改 Card + mono meta
6. **所有 Modal**：`DistillModal`、`SkillForm`、`ProjectOverridePanel`、其他（导入、删除确认、错误）全部走新 Modal 组件

## 6. 主题切换

- 顶栏右上按钮 `☾/☼`（dark 显示 ☼，表示"切到亮色"；反之 ☾）
- 持久化：`localStorage.crossing_theme` = `"dark" | "light"`
- 初始化顺序：
  1. 读 `localStorage.crossing_theme`，命中即应用
  2. 否则读 `window.matchMedia('(prefers-color-scheme: light)')` 匹配结果
  3. 默认 dark
- 切换时：在 `<html>` 加/去 `data-theme="light"`；不做过渡动画（见范围外）
- 提供 `useTheme()` hook 暴露 `{ theme, toggle, setTheme }`

## 7. 迁移策略

1. 新建 `src/styles/tokens.css`，集中声明 `:root` 与 `[data-theme="light"]` 两份变量；`main.tsx` 顶部 import
2. Tailwind 配置 `theme.extend.colors` 用 `rgb(from var(--xxx) r g b / <alpha-value>)` 包装成命名色，如 `bg-0`, `fg-body`, `accent`；业务代码用 `bg-bg-1`, `text-fg-body`, `border-hair` 等 utility
3. 旧手写 `var(--border)` / `var(--green)` / `var(--text-muted)` 全量替换到新 token 名（准备一份映射表 `MIGRATION.md` 作为 PR 补充材料，不提交到本 spec 目录）
4. 分三批 PR：
   - P1：tokens + 基础组件库
   - P2：首页 + ProjectWorkbench + Writer
   - P3：ConfigWorkbench + StylePanels + 所有 Modal
5. 每批都在 dark / light 两模式手测截图，贴进 PR 描述

## 8. 验收

- [ ] `src/styles/tokens.css` 两套 token 与 mockup v5 完全一致
- [ ] 全站 `grep -R '#[0-9a-fA-F]\{3,6\}' src/` 返回 0 条硬编码色（允许少数 SVG 内联例外，集中列表白名单）
- [ ] Pixel 字体仅在 logo + version tag + 指定 chip 出现（自动化 lint：`.font-pixel` class 只允许在白名单文件）
- [ ] 顶栏主题按钮切换后 localStorage 正确持久化，刷新保持
- [ ] 系统 `prefers-color-scheme` 变化时，未显式设定过的用户自动跟随
- [ ] ProjectList / ProjectWorkbench / Writer / ConfigWorkbench / StylePanels 五个页面 dark + light 各截图 1 张与 mockup 视觉 diff < 可接受阈值
- [ ] `SelectionBubble` / `InlineComposer` 在段落卡上悬浮对比度 WCAG AA
- [ ] 所有 Modal 统一使用新 Modal 组件，无旧 `.modal-old` 残留
- [ ] Pixel icon set 8 个图标均有 16 / 24 两档 SVG，引入 `<Icon name="agent" />` 统一 API
- [ ] ProgressBar / Chip / Button 三个组件在 Storybook（或等价预览页）展示全 variant
- [ ] `npm run build` 通过；首屏 CSS 体积相比迁移前增量 < 15 KB gzip

## 9. 不在本 spec 范围

- 动画 / 过渡效果库（未来 SP-1x 再做 motion design）
- 响应式移动端（当前仍以桌面 1280+ 为主）
- 国际化文案（仅视觉改造，不动 i18n）
- 主题之外的第三套「高对比度」或「护眼米色」配色
- 品牌插画 / 启动动画 / 404 页彩蛋

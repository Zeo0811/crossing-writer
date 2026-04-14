# SP-11 CLI Health Dashboard 设计

> 日期：2026-04-14
> 状态：草案
> 关联：SP-06 Style Distiller、SP-05 Writer、SP-10 Config Workbench

## 1. 动机

用户在蒸馏、写作、选段改写等场景，强依赖本地的 `claude` 和 `codex` 两个 CLI。实际使用中经常遇到：

- CLI 未安装（新机器、刚拉代码）
- CLI 已安装但未登录（`claude /login` / `codex login` 未执行）
- CLI 被误卸载或 PATH 丢失

这些问题要等到"点了开始写"、转圈几十秒后抛错，才被用户察觉，体验极差。

SP-11 的目标：**在顶部导航常驻一个 CLI 健康指示器，让用户打开页面就能一眼看到 claude / codex 是否就绪，未就绪时直接给出复制即用的安装/登录命令。**

## 2. 核心概念

- **Health Probe**：后端服务 `CliHealthProber`，周期性调用 `claude --version` / `codex --version`，以 2s 超时判定 CLI 是否可用。
- **Indicator Component**：前端 `CliHealthDot`，在 ProjectList 顶部导航右侧渲染两枚带标签的小圆点。
- **Hover Modal**：鼠标悬停圆点时弹出浮层，展示当前状态、版本号或错误原因，以及一键复制的修复命令。

## 3. 架构

### 3.1 Backend

**路由**：`GET /api/system/cli-health`

```ts
// packages/backend/src/routes/systemHealth.ts
type CliStatus = 'online' | 'offline' | 'error';
interface CliHealthItem {
  status: CliStatus;
  version?: string;   // 仅 online 时带
  error?: string;     // offline/error 时的简短原因
  checkedAt: string;  // ISO 时间
}
interface CliHealthResponse {
  claude: CliHealthItem;
  codex: CliHealthItem;
}
```

**服务**：`CliHealthProber`

- 位置：`packages/backend/src/services/cliHealth.ts`
- 方法：`probe(): Promise<CliHealthResponse>`
- 实现：并发 `execFile('claude', ['--version'])` 与 `execFile('codex', ['--version'])`
  - 每个子命令超时 2s（`timeout: 2000`）
  - 返回码 0 且 stdout 匹配 `/\d+\.\d+/` → `online` + 解析出的 version
  - `ENOENT` / 找不到命令 → `offline`，error 填 `"command not found"`
  - 其他错误（超时、非 0 退出、输出异常） → `error`，error 填一行简短描述
- 缓存：进程内 30s TTL，避免并发页面同时 probe
- 缓存实现：`let cached: { at: number; data: CliHealthResponse } | null`，`probe()` 内判断 `Date.now() - cached.at < 30_000`

路由 handler 仅调用 `prober.probe()` 并返回 JSON。

### 3.2 Frontend

**组件**：`packages/web-ui/src/components/CliHealthDot.tsx`

```tsx
interface Props {
  label: 'CLAUDE' | 'CODEX';
  item: CliHealthItem;
}
```

- 渲染：一个 8px 圆点（online=绿 `#22c55e`，offline/error=红 `#ef4444`）+ 标签文字
- 悬停：触发 `<CliHealthTooltip>` 浮层（使用已有 Tooltip 模式或 Radix Popover）

**Hook**：`useCliHealth()` —— `packages/web-ui/src/hooks/useCliHealth.ts`

- 初次挂载立即 fetch 一次
- `setInterval` 每 30s 再 fetch
- 失败重试间隔保持 30s，不做指数退避（后端已经 cache）
- 返回 `{ data, loading, error }`

**集成**：在 `packages/web-ui/src/pages/ProjectList.tsx` 顶部导航（现有 line ~20-33 的 inline 结构）右侧追加：

```tsx
<div className="flex items-center gap-3">
  <CliHealthDot label="CLAUDE" item={data.claude} />
  <CliHealthDot label="CODEX" item={data.codex} />
  {/* 已有的 Config workbench 链接 */}
</div>
```

### 3.3 Install / Login 命令表

硬编码在前端（`cliInstallHints.ts`）：

| CLI     | offline 提示                                  |
| ------- | --------------------------------------------- |
| claude  | `npm i -g @anthropic-ai/claude-code` + `claude /login` |
| codex   | `brew install codex` + `codex login`          |

`error` 状态展示错误文本，同时仍给出登录命令（多数 error 是未登录导致）。

## 4. API 契约

**请求**：`GET /api/system/cli-health`（无参数）

**响应示例**：

```json
{
  "claude": { "status": "online", "version": "1.4.2", "checkedAt": "2026-04-14T10:00:00Z" },
  "codex":  { "status": "offline", "error": "command not found", "checkedAt": "2026-04-14T10:00:00Z" }
}
```

**错误**：该路由本身不返回 4xx/5xx；任何 probe 失败都归纳为 item 内的 `status: 'error'`。唯一例外是 prober 本身抛未捕获异常（理论不发生），此时返回 500 + `{ message }`。

## 5. UI 细节

- 圆点尺寸 8×8 px，外加 2px halo 表示"正在 probe"（loading 状态）
- 标签字号 11px，字重 500，颜色随状态浅染（online: `#16a34a`，offline: `#b91c1c`）
- Hover modal（宽 280px）内容布局：
  - 标题行：`CLAUDE · ONLINE v1.4.2` 或 `CLAUDE · OFFLINE`
  - 状态描述：一段灰色小字（online 显示 `checkedAt` 相对时间；offline/error 显示 error）
  - 分隔线
  - `安装 / 登录命令`段，每条命令一行，行尾一个 Copy 按钮（复用已有 `CopyButton`）
  - 底部灰字：`每 30 秒自动检测`
- 浮层通过 `onMouseEnter` 展开，`onMouseLeave` 延迟 150ms 关闭，允许鼠标移入 modal 点 Copy

## 6. 数据流

```
页面挂载
  └─ useCliHealth fetch /api/system/cli-health (t=0)
       └─ Backend: cache miss → CliHealthProber.probe()
            └─ 并发 execFile('claude --version') / execFile('codex --version') (2s 超时)
            └─ 写入进程缓存 (30s TTL)
       └─ 返回 JSON

每 30s
  └─ setInterval 再次 fetch
       └─ Backend: cache hit (或刚好过期 → 重新 probe)
```

缓存失效策略：纯时间 TTL（30s）。不实现手动清除——用户手动重试只需等下一次轮询，或刷新页面。

## 7. 验收

- [ ] `GET /api/system/cli-health` 在 claude/codex 均安装并登录时返回两个 `online` + version
- [ ] 卸载 claude 后 30s 内前端小圆点变红；hover 显示 `command not found` 与安装命令
- [ ] 后端 `CliHealthProber` 在 2s 超时下不会阻塞事件循环超过 2s
- [ ] 同一页面 30s 内重复刷新，`execFile` 实际只被调用一次（缓存命中）
- [ ] Hover modal 的 Copy 按钮能把命令写入剪贴板
- [ ] 关闭/打开页面不会造成 polling 泄漏（`useEffect` 清理 interval）
- [ ] ProjectList 顶部导航在窄屏（<480px）下仍能看到两枚圆点（标签可隐藏，保留 title 属性）
- [ ] 新增 vitest 用例覆盖：probe online、probe offline (ENOENT)、probe error (timeout)、cache hit

## 8. 不在本 spec 范围

- CLI 的自动安装 / 自动 `claude login` / `codex login`（安全性敏感，需另起 spec）
- Windows 平台的命令差异（当前只支持 macOS / Linux）
- 更多 CLI（如 gemini、ollama）的探测——架构可扩展，但本期只做 claude + codex
- 在 Config Workbench 里的详尽诊断面板（本期只做顶部导航的极简指示器）

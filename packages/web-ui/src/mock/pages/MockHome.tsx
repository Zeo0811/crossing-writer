import { useMock } from "../MockProvider";

const CHECKPOINTS = [
  { id: 0, label: "全局壳", desc: "TopBar / SideNav / Theme / Toast / ⌘K", status: "current" },
  { id: 1, label: "ProjectList", desc: "卡片 / 状态 / 创建 / 归档", status: "todo" },
  { id: 2, label: "新建 + Brief", desc: "文本 / 文件 / 多图", status: "todo" },
  { id: 3, label: "Brief 解析 + Mission", desc: "loading / 候选 / 重选", status: "todo" },
  { id: 4, label: "产品概览", desc: "生成 / 编辑 / 补图", status: "todo" },
  { id: 5, label: "Case 规划", desc: "专家 / 生成 / 批准", status: "todo" },
  { id: 6, label: "Evidence", desc: "截图 / 录屏 / 笔记", status: "todo" },
  { id: 7, label: "写作", desc: "section / rewrite / @-mention", status: "todo" },
  { id: 8, label: "审稿 + 终稿 + 导出", desc: "reviewer / markdown / 发布", status: "todo" },
  { id: 9, label: "配置区", desc: "CLI / 模型 / 风格 / 知识库", status: "todo" },
];

export function MockHome() {
  const m = useMock();
  return (
    <div className="p-8 max-w-[1100px] mx-auto">
      <header className="mb-8">
        <div className="flex items-baseline gap-3 mb-2">
          <h1
            className="text-[var(--accent)] text-[14px] tracking-[3px]"
            style={{ fontFamily: "var(--font-pixel)" }}
          >
            v1.5.0 MOCKUP
          </h1>
          <span className="text-[var(--faint)] text-xs">retro-pixel terminal · interactive prototype</span>
        </div>
        <h2 className="text-2xl text-[var(--heading)] font-semibold tracking-tight">UI 改版走查 · Checkpoint 0 / 9</h2>
        <p className="text-sm text-[var(--meta)] mt-2 max-w-[640px]">
          这里是十字路口写作工作台的 UI 重构 mockup。当前阶段 <strong className="text-[var(--accent)]">全局壳</strong>。
          顶栏、侧栏、主题切换、Toast、⌘K 命令面板、右下 mock 控制板已就位。
          后续每个 checkpoint 会逐步把内部页面的 mockup 长出来。
        </p>
      </header>

      <section className="grid grid-cols-3 gap-3 mb-10">
        <DemoCard
          title="主题切换"
          body={`当前：${m.theme === "dark" ? "深色" : "亮色"}`}
          action="切换"
          onAction={m.toggleTheme}
        />
        <DemoCard
          title="Command Palette"
          body="按 ⌘K 打开 / 输入「项目」「切换」试试"
          action="打开"
          onAction={() => m.setPaletteOpen(true)}
        />
        <DemoCard
          title="Toast 演示"
          body="点击右下 MOCK 面板挑一种样式"
          action="success"
          onAction={() => m.pushToast({ type: "success", message: "✅ 这是一个 success toast" })}
        />
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[var(--heading)] text-sm uppercase tracking-wider">Checkpoint 路线</h3>
          <span className="text-[10px] text-[var(--faint)]" style={{ fontFamily: "var(--font-pixel)" }}>0 / 9 LIVE</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {CHECKPOINTS.map((c) => (
            <div
              key={c.id}
              className={`flex items-center gap-3 p-3 rounded border ${
                c.status === "current"
                  ? "border-[var(--accent-soft)] bg-[var(--accent-fill)]"
                  : "border-[var(--hair)] bg-[var(--bg-1)] opacity-70"
              }`}
            >
              <span
                className="w-8 h-8 flex items-center justify-center rounded border border-[var(--hair-strong)] text-[var(--meta)]"
                style={{ fontFamily: "var(--font-pixel)", fontSize: 11 }}
              >
                {String(c.id).padStart(2, "0")}
              </span>
              <div className="flex-1 min-w-0">
                <div className={`text-sm ${c.status === "current" ? "text-[var(--accent)]" : "text-[var(--heading)]"}`}>{c.label}</div>
                <div className="text-xs text-[var(--meta)] truncate">{c.desc}</div>
              </div>
              {c.status === "current" && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded-sm bg-[var(--accent)] text-[var(--accent-on)]"
                  style={{ fontFamily: "var(--font-pixel)" }}
                >
                  LIVE
                </span>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function DemoCard({ title, body, action, onAction }: { title: string; body: string; action: string; onAction: () => void }) {
  return (
    <div className="rounded border border-[var(--hair)] bg-[var(--bg-1)] p-4">
      <div className="text-[10px] uppercase tracking-wider text-[var(--meta)] mb-1">{title}</div>
      <div className="text-sm text-[var(--body)] mb-3 min-h-[40px]">{body}</div>
      <button
        onClick={onAction}
        className="px-3 py-1 text-xs rounded border border-[var(--accent-soft)] text-[var(--accent)] hover:bg-[var(--accent-fill)]"
      >
        {action}
      </button>
    </div>
  );
}

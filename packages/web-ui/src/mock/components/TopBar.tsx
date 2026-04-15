import { Link, useLocation, useNavigate } from "react-router-dom";
import { useMock } from "../MockProvider";
import { ThemeToggle } from "./ThemeToggle";

const ROUTE_LABELS: Record<string, string> = {
  "/mock": "Projects",
  "/mock/projects": "Projects",
  "/mock/knowledge": "Knowledge",
  "/mock/style-panels": "Style Panels",
  "/mock/config": "Config",
  "/mock/settings": "Settings",
};

function CliLight({ health }: { health: "ok" | "slow" | "down" }) {
  const color = health === "ok" ? "var(--accent)" : health === "slow" ? "var(--amber)" : "var(--red)";
  const label = health === "ok" ? "CLI" : health === "slow" ? "CLI slow" : "CLI down";
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded border border-[var(--hair)] bg-[var(--bg-1)]">
      <span className="w-2 h-2 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
      <span className="text-[11px] text-[var(--meta)] uppercase tracking-wider">{label}</span>
    </div>
  );
}

function Breadcrumb() {
  const loc = useLocation();
  const path = loc.pathname;
  const segments: { label: string; to?: string }[] = [{ label: "Crossing", to: "/mock" }];
  // very small demo crumbs
  if (path.startsWith("/mock/projects/")) {
    segments.push({ label: "Projects", to: "/mock" });
    segments.push({ label: "测评 Cursor IDE" });
  } else {
    const top = ROUTE_LABELS[path] ?? "Projects";
    if (top !== "Crossing") segments.push({ label: top });
  }
  return (
    <nav className="flex items-center gap-1.5 text-sm">
      {segments.map((s, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-[var(--faint)]">/</span>}
          {s.to ? (
            <Link to={s.to} className="text-[var(--meta)] hover:text-[var(--accent)] transition-colors">{s.label}</Link>
          ) : (
            <span className="text-[var(--heading)]">{s.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function TopBar() {
  const m = useMock();
  const navigate = useNavigate();
  return (
    <header
      className="h-14 px-4 flex items-center justify-between border-b border-[var(--hair)] bg-[var(--bg-1)] sticky top-0 z-20"
    >
      <div className="flex items-center gap-3 min-w-[260px]">
        <button
          onClick={() => navigate("/mock")}
          className="flex items-center gap-2 group"
          aria-label="Home"
        >
          <span
            className="text-[13px] tracking-[2px] text-[var(--accent)] group-hover:drop-shadow-[0_0_6px_var(--accent)] transition-all"
            style={{ fontFamily: "var(--font-pixel)" }}
          >
            CROSSING
          </span>
          <span
            className="px-1.5 py-0.5 text-[10px] border border-[var(--hair-strong)] text-[var(--meta)] rounded-sm"
            style={{ fontFamily: "var(--font-pixel)" }}
          >
            v1.5.0
          </span>
        </button>
      </div>

      <div className="flex-1 flex justify-center">
        <Breadcrumb />
      </div>

      <div className="flex items-center gap-2 min-w-[260px] justify-end">
        <button
          onClick={() => m.setCliHealth(m.cliHealth === "ok" ? "slow" : m.cliHealth === "slow" ? "down" : "ok")}
          title="点击切换演示 CLI 健康状态"
        >
          <CliLight health={m.cliHealth} />
        </button>
        <ThemeToggle />
        <button
          onClick={() => m.setPaletteOpen(true)}
          className="flex items-center gap-2 px-2.5 py-1 rounded border border-[var(--hair)] bg-[var(--bg-1)] text-[var(--meta)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
        >
          <span className="text-xs">搜索</span>
          <kbd
            className="px-1.5 py-0.5 text-[10px] rounded-sm border border-[var(--hair-strong)] bg-[var(--kbd-bg)] text-[var(--meta)]"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            ⌘K
          </kbd>
        </button>
      </div>
    </header>
  );
}

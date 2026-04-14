import { NavLink } from "react-router-dom";
import { useTheme } from "../../hooks/useTheme";

interface TopNavProps {
  version?: string;
  breadcrumb?: string[];
}

const LINKS = [
  { to: "/", label: "Projects", end: true },
  { to: "/style-panels", label: "Library" },
  { to: "/config", label: "Settings" },
];

export function TopNav({ version = "v0.14", breadcrumb }: TopNavProps) {
  const { theme, toggle } = useTheme();
  return (
    <nav
      data-testid="topnav"
      className="flex items-center justify-between px-[18px] py-3 bg-bg-1 border border-hair rounded-[6px]"
      aria-label="Primary"
    >
      <div className="flex items-center gap-[14px]">
        <span className="font-pixel text-[13px] tracking-[0.06em] text-accent">
          CROSSING.WRITER
        </span>
        <span className="font-pixel text-[8px] tracking-[0.08em] text-accent-dim">
          {version}
        </span>
        {breadcrumb && breadcrumb.length > 0 && (
          <span className="font-mono-term text-[11px] text-meta" data-testid="topnav-breadcrumb">
            {breadcrumb.map((b, i) => (
              <span key={i}>
                {i > 0 && <span className="mx-1 text-faint">/</span>}
                {b}
              </span>
            ))}
          </span>
        )}
        <span
          aria-hidden
          className="w-4 h-4 rounded-[3px] bg-pink"
          style={{ imageRendering: "pixelated", boxShadow: "0 0 0 1px var(--pink-shadow)" }}
        />
      </div>
      <div className="flex items-center gap-[22px] text-[13px] text-meta">
        {LINKS.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.end}
            className={({ isActive }) =>
              `no-underline ${isActive ? "text-heading relative after:content-[''] after:absolute after:left-0 after:right-0 after:-bottom-1 after:h-[2px] after:bg-accent after:rounded-[2px]" : "text-meta hover:text-body"}`
            }
          >
            {l.label}
          </NavLink>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5 text-[11px] px-2 py-[3px] bg-bg-2 border border-hair rounded-[2px]">
          <span className="text-accent">●</span> claude_ready
        </span>
        <button
          type="button"
          onClick={toggle}
          aria-label="Toggle theme"
          title="Toggle theme"
          className="font-mono-term text-[13px] leading-none w-7 h-[26px] inline-flex items-center justify-center bg-bg-2 text-body border border-hair rounded-[2px] cursor-pointer hover:border-accent hover:text-accent transition-colors"
        >
          {theme === "light" ? "☼" : "☾"}
        </button>
      </div>
    </nav>
  );
}

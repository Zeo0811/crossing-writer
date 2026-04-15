import { NavLink } from "react-router-dom";
import { useState } from "react";

interface NavItem {
  to: string;
  label: string;
  icon: string;
  pinBottom?: boolean;
}

const ITEMS: NavItem[] = [
  { to: "/mock", label: "Projects", icon: "▣" },
  { to: "/mock/knowledge", label: "Knowledge", icon: "✦" },
  { to: "/mock/style-panels", label: "Style", icon: "✎" },
  { to: "/mock/config", label: "Config", icon: "⚙" },
  { to: "/mock/settings", label: "Settings", icon: "◉", pinBottom: true },
];

export function SideNav() {
  const [hover, setHover] = useState(false);
  const expanded = hover;
  return (
    <aside
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="border-r border-[var(--hair)] bg-[var(--bg-1)] flex flex-col py-3 transition-all duration-150 ease-out z-10"
      style={{ width: expanded ? 200 : 64 }}
    >
      <div className="flex-1 flex flex-col gap-1 px-2">
        {ITEMS.filter((i) => !i.pinBottom).map((item) => (
          <NavItemLink key={item.to} item={item} expanded={expanded} />
        ))}
      </div>
      <div className="flex flex-col gap-1 px-2">
        {ITEMS.filter((i) => i.pinBottom).map((item) => (
          <NavItemLink key={item.to} item={item} expanded={expanded} />
        ))}
      </div>
    </aside>
  );
}

function NavItemLink({ item, expanded }: { item: NavItem; expanded: boolean }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === "/mock"}
      className={({ isActive }) =>
        `flex items-center h-10 rounded gap-3 px-3 text-sm transition-colors overflow-hidden ${
          isActive
            ? "bg-[var(--accent-fill)] text-[var(--accent)] border border-[var(--accent-soft)]"
            : "text-[var(--meta)] hover:text-[var(--heading)] hover:bg-[var(--bg-2)]"
        }`
      }
    >
      <span className="text-[15px] leading-none w-6 text-center" aria-hidden>
        {item.icon}
      </span>
      <span
        className="whitespace-nowrap transition-opacity"
        style={{ opacity: expanded ? 1 : 0 }}
      >
        {item.label}
      </span>
    </NavLink>
  );
}

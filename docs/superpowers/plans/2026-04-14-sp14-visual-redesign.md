# SP-14 Retro-Pixel Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the entire `packages/web-ui` frontend to the retro-pixel terminal visual language defined in SP-14 — dark default + light option, full CSS token system, minimal but complete component library, restyled core pages.

**Architecture:** Introduce `:root` + `[data-theme="light"]` CSS custom-property token sheet as the single source of truth; wire Tailwind v4 `@theme` to expose tokens as utility classes; rebuild primitives (Button, Chip, Card, Input, Select, Checkbox, ProgressBar, Modal, Icon set) in `src/components/ui/`; add `useTheme` hook persisting to `localStorage.crossing_theme` with `prefers-color-scheme` fallback; restyle pages top-down (ProjectList → ProjectWorkbench → Writer → ConfigWorkbench → StylePanels) and refit all Modal usages to the new primitive. No hex literals in business code — all values flow through tokens.

**Tech Stack:** React 19, TypeScript, Tailwind v4 (CSS-first `@theme`), Vite, Vitest + @testing-library/react, Google Fonts (Press Start 2P, VT323, Inter, IBM Plex Mono, Noto Sans SC).

---

## File Map

**Created:**
- `packages/web-ui/src/styles/tokens.css` — `:root` dark + `[data-theme="light"]` token declarations (rewrite; existing file is superseded)
- `packages/web-ui/src/hooks/useTheme.ts` — theme state hook
- `packages/web-ui/src/components/ui/Button.tsx`
- `packages/web-ui/src/components/ui/Chip.tsx`
- `packages/web-ui/src/components/ui/Card.tsx`
- `packages/web-ui/src/components/ui/Input.tsx`
- `packages/web-ui/src/components/ui/Select.tsx`
- `packages/web-ui/src/components/ui/Checkbox.tsx`
- `packages/web-ui/src/components/ui/ProgressBar.tsx`
- `packages/web-ui/src/components/ui/Modal.tsx`
- `packages/web-ui/src/components/icons/*.tsx` — 9 pixel SVG icons
- `packages/web-ui/src/components/layout/TopNav.tsx` — replacement top nav
- Matching `tests/components/ui/*.test.tsx` and `tests/hooks/use-theme.test.tsx`

**Modified:**
- `packages/web-ui/index.html` — Google Fonts preconnect + link
- `packages/web-ui/src/main.tsx` — import `tokens.css`
- `packages/web-ui/src/styles/globals.css` — Tailwind v4 `@theme` mapping to tokens, font utilities
- `packages/web-ui/src/pages/ProjectList.tsx` — apply new primitives

---

## Task 1: CSS token system

**Files:**
- Create: `packages/web-ui/src/styles/tokens.css`
- Modify: `packages/web-ui/src/main.tsx`
- Test: `packages/web-ui/tests/styles/tokens.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/web-ui/tests/styles/tokens.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import "../../src/styles/tokens.css";

describe("tokens.css", () => {
  beforeAll(() => {
    document.documentElement.removeAttribute("data-theme");
  });

  it("exposes dark tokens on :root by default", () => {
    const s = getComputedStyle(document.documentElement);
    expect(s.getPropertyValue("--bg-0").trim()).toBe("#081208");
    expect(s.getPropertyValue("--bg-1").trim()).toBe("#0f1a11");
    expect(s.getPropertyValue("--accent").trim()).toBe("#40ff9f");
    expect(s.getPropertyValue("--body").trim()).toBe("#dae3d9");
    expect(s.getPropertyValue("--hair").trim()).toBe("#1e2e21");
  });

  it("switches to light tokens when data-theme=light", () => {
    document.documentElement.setAttribute("data-theme", "light");
    const s = getComputedStyle(document.documentElement);
    expect(s.getPropertyValue("--bg-0").trim()).toBe("#f5f6f7");
    expect(s.getPropertyValue("--bg-1").trim()).toBe("#ffffff");
    expect(s.getPropertyValue("--accent").trim()).toBe("#1f9e5c");
    expect(s.getPropertyValue("--body").trim()).toBe("#1d2126");
    document.documentElement.removeAttribute("data-theme");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @crossing/web-ui test -- tests/styles/tokens.test.ts`
Expected: FAIL (tokens do not yet include new values, or file missing).

- [ ] **Step 3: Write token file**

```css
/* packages/web-ui/src/styles/tokens.css */
:root,
:root[data-theme="dark"] {
  --bg-0: #081208;
  --bg-1: #0f1a11;
  --bg-2: #16231a;
  --hair: #1e2e21;
  --hair-strong: #2a3d2e;
  --body: #dae3d9;
  --heading: #f0f4ec;
  --meta: #7e8e7f;
  --faint: #5a6a5b;
  --accent: #40ff9f;
  --accent-soft: #2eb878;
  --accent-dim: #4a8a66;
  --accent-fill: #163726;
  --accent-on: #052612;
  --amber: #ffd166;
  --amber-bg: #2a2414;
  --amber-hair: #4a3f22;
  --red: #ff6b6b;
  --pink: #ff6ab0;
  --pink-shadow: rgba(255, 106, 176, 0.25);
  --log-bg: #0a1509;
  --kbd-bg: #132119;
  --radius: 6px;
  --radius-sm: 2px;
  --font-pixel: "Press Start 2P", "VT323", monospace;
  --font-sans: "Inter", "Noto Sans SC", "PingFang SC", system-ui, sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, Menlo, monospace;
}

:root[data-theme="light"] {
  --bg-0: #f5f6f7;
  --bg-1: #ffffff;
  --bg-2: #eceff2;
  --hair: #d8dce0;
  --hair-strong: #c2c7cd;
  --body: #1d2126;
  --heading: #0b0e12;
  --meta: #5a6572;
  --faint: #8a93a0;
  --accent: #1f9e5c;
  --accent-soft: #177a47;
  --accent-dim: #6fb891;
  --accent-fill: #d8f0e2;
  --accent-on: #ffffff;
  --amber: #a8761a;
  --amber-bg: #faecc8;
  --amber-hair: #e0c67a;
  --red: #c53030;
  --pink: #d43a8c;
  --pink-shadow: #8a2460;
  --log-bg: #f8f9fa;
  --kbd-bg: #eceff2;
}

html, body {
  background: var(--bg-0);
  color: var(--body);
  font-family: var(--font-sans);
}
```

Then in `packages/web-ui/src/main.tsx`, add as the FIRST import (above `globals.css`):

```ts
import "./styles/tokens.css";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @crossing/web-ui test -- tests/styles/tokens.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web-ui/src/styles/tokens.css packages/web-ui/src/main.tsx packages/web-ui/tests/styles/tokens.test.ts
git commit -m "sp14(T1): add dark+light CSS token system"
```

---

## Task 2: Load fonts + Tailwind font utilities

**Files:**
- Modify: `packages/web-ui/index.html`
- Modify: `packages/web-ui/src/styles/globals.css`
- Test: `packages/web-ui/tests/styles/fonts.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/web-ui/tests/styles/fonts.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const html = readFileSync(resolve(__dirname, "../../index.html"), "utf8");
const css = readFileSync(resolve(__dirname, "../../src/styles/globals.css"), "utf8");

describe("fonts", () => {
  it("index.html links Google Fonts with all five families", () => {
    expect(html).toContain("fonts.googleapis.com");
    expect(html).toMatch(/Press\+Start\+2P/);
    expect(html).toMatch(/VT323/);
    expect(html).toMatch(/Inter:wght@400;500;600/);
    expect(html).toMatch(/IBM\+Plex\+Mono/);
    expect(html).toMatch(/Noto\+Sans\+SC/);
  });

  it("globals.css exposes font utility classes via @theme", () => {
    expect(css).toMatch(/--font-pixel/);
    expect(css).toMatch(/--font-sans/);
    expect(css).toMatch(/--font-mono-term/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @crossing/web-ui test -- tests/styles/fonts.test.ts`
Expected: FAIL.

- [ ] **Step 3: Update `index.html`**

Inside `<head>`, add:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=Noto+Sans+SC:wght@400;500;600;700&family=Press+Start+2P&family=VT323&display=swap" rel="stylesheet">
```

- [ ] **Step 4: Update `globals.css`**

Prepend (keep any existing Tailwind v4 `@import "tailwindcss"` line):

```css
@import "tailwindcss";

@theme {
  --font-pixel: "Press Start 2P", "VT323", monospace;
  --font-sans: "Inter", "Noto Sans SC", "PingFang SC", system-ui, sans-serif;
  --font-mono-term: "IBM Plex Mono", ui-monospace, Menlo, monospace;

  --color-bg-0: var(--bg-0);
  --color-bg-1: var(--bg-1);
  --color-bg-2: var(--bg-2);
  --color-hair: var(--hair);
  --color-hair-strong: var(--hair-strong);
  --color-body: var(--body);
  --color-heading: var(--heading);
  --color-meta: var(--meta);
  --color-faint: var(--faint);
  --color-accent: var(--accent);
  --color-accent-soft: var(--accent-soft);
  --color-accent-dim: var(--accent-dim);
  --color-accent-fill: var(--accent-fill);
  --color-accent-on: var(--accent-on);
  --color-amber: var(--amber);
  --color-red: var(--red);
  --color-pink: var(--pink);
}
```

This makes `font-pixel`, `font-sans`, `font-mono-term`, `bg-bg-1`, `text-body`, `border-hair`, etc. available as utilities.

- [ ] **Step 5: Run test + commit**

```bash
pnpm --filter @crossing/web-ui test -- tests/styles/fonts.test.ts
git add packages/web-ui/index.html packages/web-ui/src/styles/globals.css packages/web-ui/tests/styles/fonts.test.ts
git commit -m "sp14(T2): load Google Fonts and expose Tailwind font utilities"
```

---

## Task 3: `useTheme` hook

**Files:**
- Create: `packages/web-ui/src/hooks/useTheme.ts`
- Test: `packages/web-ui/tests/hooks/use-theme.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// packages/web-ui/tests/hooks/use-theme.test.tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTheme } from "../../src/hooks/useTheme";

function setMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (q: string) => ({
      matches,
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    }),
  });
}

describe("useTheme", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("defaults to dark when no storage and no system pref", () => {
    setMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("honors localStorage override", () => {
    localStorage.setItem("crossing_theme", "light");
    setMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("light");
  });

  it("falls back to prefers-color-scheme: dark when no storage", () => {
    setMatchMedia(true);
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("dark");
  });

  it("toggle flips and persists", () => {
    setMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    act(() => result.current.toggle());
    expect(result.current.theme).toBe("light");
    expect(localStorage.getItem("crossing_theme")).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @crossing/web-ui test -- tests/hooks/use-theme.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the hook**

```ts
// packages/web-ui/src/hooks/useTheme.ts
import { useCallback, useEffect, useState } from "react";

export type Theme = "dark" | "light";
const STORAGE_KEY = "crossing_theme";

function readInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "dark" || saved === "light") return saved;
  } catch {}
  if (typeof window !== "undefined" && window.matchMedia) {
    if (window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
    if (window.matchMedia("(prefers-color-scheme: light)").matches) return "light";
  }
  return "dark";
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => readInitialTheme());

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    try { localStorage.setItem(STORAGE_KEY, t); } catch {}
    setThemeState(t);
  }, []);

  const toggle = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  return { theme, setTheme, toggle };
}
```

- [ ] **Step 4: Run test — expect PASS. Commit.**

```bash
pnpm --filter @crossing/web-ui test -- tests/hooks/use-theme.test.tsx
git add packages/web-ui/src/hooks/useTheme.ts packages/web-ui/tests/hooks/use-theme.test.tsx
git commit -m "sp14(T3): add useTheme hook with localStorage + media-query fallback"
```

---

## Task 4: TopNav redesign

**Files:**
- Create: `packages/web-ui/src/components/layout/TopNav.tsx`
- Test: `packages/web-ui/tests/components/layout/top-nav.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// packages/web-ui/tests/components/layout/top-nav.test.tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TopNav } from "../../../src/components/layout/TopNav";

function renderNav() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <TopNav version="v0.14" />
    </MemoryRouter>
  );
}

describe("TopNav", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("renders pixel logo, version, and nav links", () => {
    renderNav();
    expect(screen.getByText("CROSSING.WRITER")).toBeInTheDocument();
    expect(screen.getByText("v0.14")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /projects/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /library/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /settings/i })).toBeInTheDocument();
  });

  it("theme toggle flips data-theme and swaps glyph", () => {
    renderNav();
    const btn = screen.getByRole("button", { name: /toggle theme/i });
    expect(btn.textContent).toBe("☾");
    fireEvent.click(btn);
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(btn.textContent).toBe("☼");
  });
});
```

- [ ] **Step 2: Run — expect FAIL (module missing).**

Run: `pnpm --filter @crossing/web-ui test -- tests/components/layout/top-nav.test.tsx`

- [ ] **Step 3: Implement**

```tsx
// packages/web-ui/src/components/layout/TopNav.tsx
import { NavLink } from "react-router-dom";
import { useTheme } from "../../hooks/useTheme";

interface TopNavProps {
  version?: string;
}

const LINKS = [
  { to: "/", label: "Projects", end: true },
  { to: "/workbench", label: "Workbench" },
  { to: "/library", label: "Library" },
  { to: "/settings", label: "Settings" },
];

export function TopNav({ version = "v0.14" }: TopNavProps) {
  const { theme, toggle } = useTheme();
  return (
    <nav
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
        <span
          aria-hidden
          className="w-4 h-4 rounded-[3px] bg-pink shadow-[0_0_0_1px_var(--pink-shadow)]"
          style={{ imageRendering: "pixelated" }}
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
```

- [ ] **Step 4: Run — expect PASS. Commit.**

```bash
git add packages/web-ui/src/components/layout/TopNav.tsx packages/web-ui/tests/components/layout/top-nav.test.tsx
git commit -m "sp14(T4): redesign TopNav with pixel logo and theme toggle"
```

---

## Task 5: Button primitive

**Files:**
- Create: `packages/web-ui/src/components/ui/Button.tsx`
- Test: `packages/web-ui/tests/components/ui/button.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// packages/web-ui/tests/components/ui/button.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Button } from "../../../src/components/ui/Button";

describe("Button", () => {
  it("renders primary variant with accent bg classes", () => {
    render(<Button variant="primary">Run</Button>);
    const b = screen.getByRole("button", { name: "Run" });
    expect(b.className).toMatch(/bg-accent/);
    expect(b.className).toMatch(/text-accent-on/);
  });

  it("secondary variant has hairline border", () => {
    render(<Button variant="secondary">Cancel</Button>);
    expect(screen.getByRole("button").className).toMatch(/border-hair/);
  });

  it("ghost variant is transparent", () => {
    render(<Button variant="ghost">Skip</Button>);
    expect(screen.getByRole("button").className).toMatch(/bg-transparent/);
  });

  it("fires onClick", () => {
    const fn = vi.fn();
    render(<Button onClick={fn}>Go</Button>);
    fireEvent.click(screen.getByRole("button"));
    expect(fn).toHaveBeenCalledOnce();
  });

  it("honors disabled", () => {
    render(<Button disabled>Go</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement**

```tsx
// packages/web-ui/src/components/ui/Button.tsx
import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

const base =
  "font-sans text-[13px] font-medium tracking-[0.02em] px-[14px] py-[7px] rounded-[2px] border cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent border-accent text-accent-on font-semibold hover:bg-accent-soft hover:border-accent-soft",
  secondary:
    "bg-bg-2 border-hair text-body hover:border-accent hover:text-accent",
  ghost:
    "bg-transparent border-hair text-meta hover:text-body hover:border-hair-strong",
};

export function Button({
  variant = "secondary",
  className = "",
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`${base} ${VARIANTS[variant]} ${className}`.trim()}
      {...rest}
    />
  );
}
```

- [ ] **Step 4: Run — PASS. Commit.**

```bash
git add packages/web-ui/src/components/ui/Button.tsx packages/web-ui/tests/components/ui/button.test.tsx
git commit -m "sp14(T5): add Button primitive with primary/secondary/ghost variants"
```

---

## Task 6: Chip primitive

**Files:**
- Create: `packages/web-ui/src/components/ui/Chip.tsx`
- Test: `packages/web-ui/tests/components/ui/chip.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// packages/web-ui/tests/components/ui/chip.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Chip } from "../../../src/components/ui/Chip";

describe("Chip", () => {
  it("active uses filled dot ● and accent color", () => {
    render(<Chip variant="active">ready</Chip>);
    expect(screen.getByText("●")).toBeInTheDocument();
    expect(screen.getByText("ready").parentElement?.className).toMatch(/border-hair/);
  });

  it("waiting uses hollow dot ○", () => {
    render(<Chip variant="waiting">queued</Chip>);
    expect(screen.getByText("○")).toBeInTheDocument();
  });

  it("warn uses ◉ and amber classes", () => {
    render(<Chip variant="warn">review</Chip>);
    expect(screen.getByText("◉")).toBeInTheDocument();
    expect(screen.getByText("review").parentElement?.className).toMatch(/text-amber/);
  });

  it("legacy uses ▣", () => {
    render(<Chip variant="legacy">old</Chip>);
    expect(screen.getByText("▣")).toBeInTheDocument();
  });

  it("deleted renders strike-through style", () => {
    render(<Chip variant="deleted">gone</Chip>);
    const root = screen.getByText("gone").parentElement!;
    expect(root.className).toMatch(/line-through/);
  });
});
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement**

```tsx
// packages/web-ui/src/components/ui/Chip.tsx
import type { ReactNode } from "react";

export type ChipVariant = "active" | "waiting" | "warn" | "legacy" | "deleted";

interface ChipProps {
  variant?: ChipVariant;
  children: ReactNode;
  className?: string;
}

const CONFIG: Record<ChipVariant, { dot: string; dotClass: string; wrap: string }> = {
  active: {
    dot: "●",
    dotClass: "text-accent",
    wrap: "bg-bg-2 text-body border-hair",
  },
  waiting: {
    dot: "○",
    dotClass: "text-faint",
    wrap: "bg-bg-2 text-meta border-hair",
  },
  warn: {
    dot: "◉",
    dotClass: "text-amber",
    wrap: "bg-[var(--amber-bg)] text-amber border-[var(--amber-hair)]",
  },
  legacy: {
    dot: "▣",
    dotClass: "text-meta",
    wrap: "bg-bg-2 text-meta border-hair",
  },
  deleted: {
    dot: "●",
    dotClass: "text-red",
    wrap: "bg-bg-2 text-meta border-hair line-through",
  },
};

export function Chip({ variant = "active", children, className = "" }: ChipProps) {
  const c = CONFIG[variant];
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-[3px] border rounded-[2px] font-sans tracking-[0.02em] ${c.wrap} ${className}`.trim()}
    >
      <span className={`w-2 text-center ${c.dotClass}`}>{c.dot}</span>
      {children}
    </span>
  );
}
```

- [ ] **Step 4: Run — PASS. Commit.**

```bash
git add packages/web-ui/src/components/ui/Chip.tsx packages/web-ui/tests/components/ui/chip.test.tsx
git commit -m "sp14(T6): add Chip primitive with 5 status variants"
```

---

## Task 7: Card primitive

**Files:**
- Create: `packages/web-ui/src/components/ui/Card.tsx`
- Test: `packages/web-ui/tests/components/ui/card.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// packages/web-ui/tests/components/ui/card.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Card } from "../../../src/components/ui/Card";

describe("Card", () => {
  it("renders section variant with bg-1 + hair border", () => {
    render(<Card data-testid="c">body</Card>);
    const el = screen.getByTestId("c");
    expect(el.className).toMatch(/bg-bg-1/);
    expect(el.className).toMatch(/border-hair/);
  });

  it("panel variant uses bg-2 no border", () => {
    render(<Card variant="panel" data-testid="c">x</Card>);
    expect(screen.getByTestId("c").className).toMatch(/bg-bg-2/);
  });

  it("agent variant adds accent left strip", () => {
    render(<Card variant="agent" data-testid="c">x</Card>);
    expect(screen.getByTestId("c").className).toMatch(/border-l-2/);
  });

  it("renders halftone corner when halftone=true", () => {
    render(<Card halftone data-testid="c">x</Card>);
    const el = screen.getByTestId("c");
    expect(el.querySelector("[data-halftone]")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement**

```tsx
// packages/web-ui/src/components/ui/Card.tsx
import type { HTMLAttributes } from "react";

type Variant = "section" | "agent" | "panel";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: Variant;
  halftone?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  section: "bg-bg-1 border border-hair rounded-[6px] px-6 py-[22px] relative",
  agent:
    "bg-bg-2 border border-hair border-l-2 border-l-accent rounded-[6px] p-[18px] flex flex-col gap-3 relative",
  panel: "bg-bg-2 border-0 rounded-[6px] p-[18px] relative",
};

export function Card({
  variant = "section",
  halftone = false,
  className = "",
  children,
  ...rest
}: CardProps) {
  return (
    <div className={`${VARIANTS[variant]} ${className}`.trim()} {...rest}>
      {halftone && (
        <div
          data-halftone
          aria-hidden
          className="absolute top-[10px] right-3 w-[34px] h-[14px] opacity-45 pointer-events-none"
          style={{
            backgroundImage: "radial-gradient(var(--hair-strong) 1px, transparent 1px)",
            backgroundSize: "4px 4px",
          }}
        />
      )}
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Run — PASS. Commit.**

```bash
git add packages/web-ui/src/components/ui/Card.tsx packages/web-ui/tests/components/ui/card.test.tsx
git commit -m "sp14(T7): add Card primitive with section/agent/panel variants"
```

---

## Task 8: Input / Select / Checkbox primitives

**Files:**
- Create: `packages/web-ui/src/components/ui/Input.tsx`
- Create: `packages/web-ui/src/components/ui/Select.tsx`
- Create: `packages/web-ui/src/components/ui/Checkbox.tsx`
- Test: `packages/web-ui/tests/components/ui/form-primitives.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// packages/web-ui/tests/components/ui/form-primitives.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Input } from "../../../src/components/ui/Input";
import { Select } from "../../../src/components/ui/Select";
import { Checkbox } from "../../../src/components/ui/Checkbox";

describe("form primitives", () => {
  it("Input uses bg-2 + hair border", () => {
    render(<Input placeholder="go" />);
    const el = screen.getByPlaceholderText("go");
    expect(el.className).toMatch(/bg-bg-2/);
    expect(el.className).toMatch(/border-hair/);
  });

  it("Input fires onChange", () => {
    let v = "";
    render(<Input placeholder="g" onChange={(e) => (v = e.target.value)} />);
    fireEvent.change(screen.getByPlaceholderText("g"), { target: { value: "hi" } });
    expect(v).toBe("hi");
  });

  it("Select renders options", () => {
    render(
      <Select data-testid="s">
        <option value="a">A</option>
        <option value="b">B</option>
      </Select>
    );
    const s = screen.getByTestId("s") as HTMLSelectElement;
    expect(s.options).toHaveLength(2);
    expect(s.className).toMatch(/bg-bg-2/);
  });

  it("Checkbox renders pixel-check when checked", () => {
    render(<Checkbox checked onChange={() => {}} label="enable" />);
    expect(screen.getByLabelText("enable")).toBeChecked();
  });
});
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement Input**

```tsx
// packages/web-ui/src/components/ui/Input.tsx
import type { InputHTMLAttributes } from "react";

export function Input({ className = "", ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`bg-bg-2 border border-hair rounded-[2px] px-3 py-[7px] text-[13px] text-body font-sans placeholder:text-faint focus:outline-none focus:border-accent focus:shadow-[0_0_0_2px_var(--accent-dim)] transition-colors ${className}`.trim()}
      {...rest}
    />
  );
}
```

- [ ] **Step 4: Implement Select**

```tsx
// packages/web-ui/src/components/ui/Select.tsx
import type { SelectHTMLAttributes } from "react";

export function Select({
  className = "",
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`bg-bg-2 border border-hair rounded-[2px] px-3 py-[7px] text-[13px] text-body font-sans focus:outline-none focus:border-accent focus:shadow-[0_0_0_2px_var(--accent-dim)] transition-colors ${className}`.trim()}
      {...rest}
    >
      {children}
    </select>
  );
}
```

- [ ] **Step 5: Implement Checkbox**

```tsx
// packages/web-ui/src/components/ui/Checkbox.tsx
import type { InputHTMLAttributes } from "react";
import { useId } from "react";

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: string;
}

export function Checkbox({ label, id, className = "", ...rest }: CheckboxProps) {
  const fallback = useId();
  const ctrlId = id ?? fallback;
  return (
    <span className={`inline-flex items-center gap-2 text-[13px] text-body ${className}`.trim()}>
      <input
        id={ctrlId}
        type="checkbox"
        className="appearance-none w-[14px] h-[14px] bg-bg-2 border border-hair rounded-[2px] checked:bg-accent checked:border-accent cursor-pointer relative checked:after:content-['✓'] checked:after:absolute checked:after:inset-0 checked:after:text-accent-on checked:after:text-[10px] checked:after:leading-[12px] checked:after:text-center checked:after:font-pixel"
        {...rest}
      />
      {label && <label htmlFor={ctrlId}>{label}</label>}
    </span>
  );
}
```

- [ ] **Step 6: Run — PASS. Commit.**

```bash
git add packages/web-ui/src/components/ui/Input.tsx packages/web-ui/src/components/ui/Select.tsx packages/web-ui/src/components/ui/Checkbox.tsx packages/web-ui/tests/components/ui/form-primitives.test.tsx
git commit -m "sp14(T8): add Input/Select/Checkbox primitives"
```

---

## Task 9: ProgressBar primitive

**Files:**
- Create: `packages/web-ui/src/components/ui/ProgressBar.tsx`
- Test: `packages/web-ui/tests/components/ui/progress-bar.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// packages/web-ui/tests/components/ui/progress-bar.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProgressBar } from "../../../src/components/ui/ProgressBar";

describe("ProgressBar", () => {
  it("renders filled width and label", () => {
    render(<ProgressBar value={42} />);
    expect(screen.getByText("42%")).toBeInTheDocument();
    const fill = document.querySelector("[data-fill]") as HTMLElement;
    expect(fill.style.width).toBe("42%");
  });

  it("clamps out-of-range values", () => {
    render(<ProgressBar value={999} />);
    const fill = document.querySelector("[data-fill]") as HTMLElement;
    expect(fill.style.width).toBe("100%");
  });

  it("hides label when showLabel=false", () => {
    render(<ProgressBar value={10} showLabel={false} />);
    expect(screen.queryByText("10%")).toBeNull();
  });
});
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement**

```tsx
// packages/web-ui/src/components/ui/ProgressBar.tsx
interface ProgressBarProps {
  value: number;
  showLabel?: boolean;
  className?: string;
}

export function ProgressBar({ value, showLabel = true, className = "" }: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className={`flex items-center gap-2 ${className}`.trim()}>
      <div
        className="flex-1 h-1 bg-hair rounded-[2px] overflow-hidden"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div data-fill className="h-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
      {showLabel && (
        <span className="font-mono-term text-[11px] text-meta tabular-nums">{pct}%</span>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run — PASS. Commit.**

```bash
git add packages/web-ui/src/components/ui/ProgressBar.tsx packages/web-ui/tests/components/ui/progress-bar.test.tsx
git commit -m "sp14(T9): add ProgressBar primitive"
```

---

## Task 10: Modal primitive

**Files:**
- Create: `packages/web-ui/src/components/ui/Modal.tsx`
- Test: `packages/web-ui/tests/components/ui/modal.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// packages/web-ui/tests/components/ui/modal.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Modal } from "../../../src/components/ui/Modal";

describe("Modal", () => {
  it("does not render when open=false", () => {
    render(
      <Modal open={false} onClose={() => {}} title="t">
        body
      </Modal>
    );
    expect(screen.queryByText("body")).toBeNull();
  });

  it("renders title and body when open", () => {
    render(
      <Modal open onClose={() => {}} title="Settings">
        hello
      </Modal>
    );
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("clicking overlay fires onClose", () => {
    const fn = vi.fn();
    render(
      <Modal open onClose={fn} title="t">
        x
      </Modal>
    );
    fireEvent.click(screen.getByTestId("modal-overlay"));
    expect(fn).toHaveBeenCalledOnce();
  });

  it("Escape key fires onClose", () => {
    const fn = vi.fn();
    render(
      <Modal open onClose={fn} title="t">
        x
      </Modal>
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(fn).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement**

```tsx
// packages/web-ui/src/components/ui/Modal.tsx
import { useEffect, type ReactNode } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function Modal({ open, onClose, title, children, footer }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      data-testid="modal-overlay"
      onClick={onClose}
      className="fixed inset-0 bg-[rgba(0,0,0,0.55)] backdrop-blur-[6px] z-50 flex items-center justify-center"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="bg-bg-1 border border-hair rounded-[6px] min-w-[360px] max-w-[640px] w-[90vw] max-h-[85vh] overflow-auto"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-hair">
          <h2 className="text-[15px] font-semibold text-heading m-0">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="bg-transparent border-0 text-meta hover:text-accent cursor-pointer text-[16px] leading-none"
          >
            ✕
          </button>
        </div>
        <div className="px-6 py-5 text-body text-[13px]">{children}</div>
        {footer && (
          <div className="px-6 py-4 border-t border-hair flex justify-end gap-2">{footer}</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run — PASS. Commit.**

```bash
git add packages/web-ui/src/components/ui/Modal.tsx packages/web-ui/tests/components/ui/modal.test.tsx
git commit -m "sp14(T10): add Modal primitive with overlay + ESC + blur"
```

---

## Task 11: Pixel icon set

**Files:**
- Create: `packages/web-ui/src/components/icons/Icon.tsx` — wrapper
- Create: `packages/web-ui/src/components/icons/{Agent,Tool,Style,Wiki,Raw,Config,Distill,HealthDot,Sprite}.tsx`
- Create: `packages/web-ui/src/components/icons/index.ts`
- Test: `packages/web-ui/tests/components/icons/icons.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// packages/web-ui/tests/components/icons/icons.test.tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import {
  AgentIcon, ToolIcon, StyleIcon, WikiIcon, RawIcon,
  ConfigIcon, DistillIcon, HealthDotIcon, SpriteIcon,
} from "../../../src/components/icons";

const ALL = [AgentIcon, ToolIcon, StyleIcon, WikiIcon, RawIcon, ConfigIcon, DistillIcon, HealthDotIcon, SpriteIcon];

describe("pixel icons", () => {
  it("each icon renders an SVG with crispEdges shape rendering", () => {
    ALL.forEach((Icon) => {
      const { container } = render(<Icon size={16} />);
      const svg = container.querySelector("svg")!;
      expect(svg).toBeTruthy();
      expect(svg.getAttribute("shape-rendering")).toBe("crispEdges");
      expect(svg.getAttribute("width")).toBe("16");
    });
  });

  it("size prop passes through", () => {
    const { container } = render(<AgentIcon size={24} />);
    expect(container.querySelector("svg")!.getAttribute("width")).toBe("24");
  });
});
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement wrapper**

```tsx
// packages/web-ui/src/components/icons/Icon.tsx
import type { SVGProps, ReactNode } from "react";

export interface PixelIconProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  size?: number;
  children?: ReactNode;
}

export function PixelIcon({ size = 16, children, ...rest }: PixelIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      fill="currentColor"
      {...rest}
    >
      {children}
    </svg>
  );
}
```

- [ ] **Step 4: Implement 9 icons (same pattern each)**

Create each file with this template; the `<rect>` lists are the pixel art. Use 1×1 rects with `fill="currentColor"`.

```tsx
// packages/web-ui/src/components/icons/Agent.tsx
import { PixelIcon, type PixelIconProps } from "./Icon";
export function AgentIcon(p: PixelIconProps) {
  return (
    <PixelIcon {...p}>
      <rect x="6" y="2" width="4" height="2" />
      <rect x="5" y="4" width="6" height="4" />
      <rect x="6" y="5" width="1" height="1" fill="var(--bg-1)" />
      <rect x="9" y="5" width="1" height="1" fill="var(--bg-1)" />
      <rect x="4" y="9" width="8" height="5" />
      <rect x="3" y="11" width="1" height="3" />
      <rect x="12" y="11" width="1" height="3" />
    </PixelIcon>
  );
}
```

```tsx
// Tool.tsx — wrench
import { PixelIcon, type PixelIconProps } from "./Icon";
export function ToolIcon(p: PixelIconProps) {
  return (
    <PixelIcon {...p}>
      <rect x="2" y="2" width="3" height="3" />
      <rect x="3" y="3" width="1" height="1" fill="var(--bg-1)" />
      <rect x="4" y="5" width="8" height="2" />
      <rect x="11" y="11" width="3" height="3" />
      <rect x="12" y="12" width="1" height="1" fill="var(--bg-1)" />
      <rect x="6" y="7" width="6" height="2" />
    </PixelIcon>
  );
}
```

```tsx
// Style.tsx — brush
import { PixelIcon, type PixelIconProps } from "./Icon";
export function StyleIcon(p: PixelIconProps) {
  return (
    <PixelIcon {...p}>
      <rect x="10" y="2" width="4" height="4" />
      <rect x="8" y="4" width="4" height="4" />
      <rect x="6" y="6" width="4" height="4" />
      <rect x="2" y="10" width="6" height="4" />
    </PixelIcon>
  );
}
```

```tsx
// Wiki.tsx — book
import { PixelIcon, type PixelIconProps } from "./Icon";
export function WikiIcon(p: PixelIconProps) {
  return (
    <PixelIcon {...p}>
      <rect x="3" y="2" width="10" height="12" />
      <rect x="5" y="4" width="6" height="1" fill="var(--bg-1)" />
      <rect x="5" y="7" width="6" height="1" fill="var(--bg-1)" />
      <rect x="5" y="10" width="4" height="1" fill="var(--bg-1)" />
    </PixelIcon>
  );
}
```

```tsx
// Raw.tsx — page
import { PixelIcon, type PixelIconProps } from "./Icon";
export function RawIcon(p: PixelIconProps) {
  return (
    <PixelIcon {...p}>
      <rect x="3" y="2" width="8" height="12" />
      <rect x="11" y="2" width="2" height="2" />
      <rect x="5" y="5" width="6" height="1" fill="var(--bg-1)" />
      <rect x="5" y="7" width="6" height="1" fill="var(--bg-1)" />
      <rect x="5" y="9" width="4" height="1" fill="var(--bg-1)" />
    </PixelIcon>
  );
}
```

```tsx
// Config.tsx — gear
import { PixelIcon, type PixelIconProps } from "./Icon";
export function ConfigIcon(p: PixelIconProps) {
  return (
    <PixelIcon {...p}>
      <rect x="6" y="1" width="4" height="2" />
      <rect x="6" y="13" width="4" height="2" />
      <rect x="1" y="6" width="2" height="4" />
      <rect x="13" y="6" width="2" height="4" />
      <rect x="4" y="4" width="8" height="8" />
      <rect x="6" y="6" width="4" height="4" fill="var(--bg-1)" />
    </PixelIcon>
  );
}
```

```tsx
// Distill.tsx — funnel
import { PixelIcon, type PixelIconProps } from "./Icon";
export function DistillIcon(p: PixelIconProps) {
  return (
    <PixelIcon {...p}>
      <rect x="2" y="2" width="12" height="2" />
      <rect x="3" y="4" width="10" height="2" />
      <rect x="5" y="6" width="6" height="2" />
      <rect x="7" y="8" width="2" height="6" />
    </PixelIcon>
  );
}
```

```tsx
// HealthDot.tsx — single dot with accent glow
import { PixelIcon, type PixelIconProps } from "./Icon";
export function HealthDotIcon(p: PixelIconProps) {
  return (
    <PixelIcon {...p}>
      <rect x="5" y="5" width="6" height="6" />
      <rect x="4" y="6" width="1" height="4" />
      <rect x="11" y="6" width="1" height="4" />
      <rect x="6" y="4" width="4" height="1" />
      <rect x="6" y="11" width="4" height="1" />
    </PixelIcon>
  );
}
```

```tsx
// Sprite.tsx — 8x8 mascot block (pink)
import { PixelIcon, type PixelIconProps } from "./Icon";
export function SpriteIcon(p: PixelIconProps) {
  return (
    <PixelIcon {...p} style={{ color: "var(--pink)" }}>
      <rect x="3" y="2" width="10" height="10" rx="1" />
      <rect x="5" y="4" width="2" height="2" fill="#fff" />
      <rect x="9" y="4" width="2" height="2" fill="#fff" />
      <rect x="3" y="9" width="10" height="3" fill="color-mix(in srgb, var(--pink) 70%, #000)" />
    </PixelIcon>
  );
}
```

```ts
// packages/web-ui/src/components/icons/index.ts
export { PixelIcon } from "./Icon";
export type { PixelIconProps } from "./Icon";
export { AgentIcon } from "./Agent";
export { ToolIcon } from "./Tool";
export { StyleIcon } from "./Style";
export { WikiIcon } from "./Wiki";
export { RawIcon } from "./Raw";
export { ConfigIcon } from "./Config";
export { DistillIcon } from "./Distill";
export { HealthDotIcon } from "./HealthDot";
export { SpriteIcon } from "./Sprite";
```

- [ ] **Step 5: Run — PASS. Commit.**

```bash
git add packages/web-ui/src/components/icons packages/web-ui/tests/components/icons/icons.test.tsx
git commit -m "sp14(T11): add 9-icon pixel SVG set"
```

> Visual regression reference: mockup v5 (`/Users/zeoooo/Downloads/crossing-writer-vibe-mockup.html`).

---

## Task 12: Restyle `ProjectList` page

**Files:**
- Modify: `packages/web-ui/src/pages/ProjectList.tsx`
- Modify: `packages/web-ui/src/App.tsx` (mount `<TopNav />` if not already global)
- Test: `packages/web-ui/tests/pages/project-list.test.tsx`

- [ ] **Step 1: Read current file**

Run: `sed -n '1,60p' packages/web-ui/src/pages/ProjectList.tsx` to confirm props + data shape before editing.

- [ ] **Step 2: Write the failing test**

```tsx
// packages/web-ui/tests/pages/project-list.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ProjectList } from "../../src/pages/ProjectList";

const projects = [
  { id: "p1", name: "ghostty-as-craft", status: "active" as const, updatedAt: "2026-04-12" },
  { id: "p2", name: "retired-demo", status: "legacy" as const, updatedAt: "2025-10-03" },
];

describe("ProjectList page", () => {
  it("renders TopNav and cards for each project", () => {
    render(
      <MemoryRouter>
        <ProjectList projects={projects} />
      </MemoryRouter>
    );
    expect(screen.getByText("CROSSING.WRITER")).toBeInTheDocument();
    expect(screen.getByText("ghostty-as-craft")).toBeInTheDocument();
    expect(screen.getByText("retired-demo")).toBeInTheDocument();
  });

  it("shows active chip on running project", () => {
    render(
      <MemoryRouter>
        <ProjectList projects={projects} />
      </MemoryRouter>
    );
    const row = screen.getByText("ghostty-as-craft").closest("[data-testid='project-card']")!;
    expect(row.textContent).toMatch(/●/);
  });

  it("shows empty state when no projects", () => {
    render(
      <MemoryRouter>
        <ProjectList projects={[]} />
      </MemoryRouter>
    );
    expect(screen.getByText(/no projects yet/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run — FAIL.**

- [ ] **Step 4: Implement**

```tsx
// packages/web-ui/src/pages/ProjectList.tsx
import { Link } from "react-router-dom";
import { TopNav } from "../components/layout/TopNav";
import { Card } from "../components/ui/Card";
import { Chip } from "../components/ui/Chip";
import { Button } from "../components/ui/Button";
import { SpriteIcon } from "../components/icons";

export interface ProjectSummary {
  id: string;
  name: string;
  status: "active" | "waiting" | "legacy" | "deleted";
  updatedAt: string;
}

interface ProjectListProps {
  projects: ProjectSummary[];
}

export function ProjectList({ projects }: ProjectListProps) {
  return (
    <div className="max-w-[1180px] mx-auto px-7 pt-7 pb-[72px] flex flex-col gap-7">
      <TopNav version="v0.14" />

      <Card halftone>
        <div className="flex justify-between items-end mb-[18px] gap-4">
          <div>
            <h2 className="font-sans font-semibold text-[15px] text-heading m-0">Projects</h2>
            <p className="text-[12px] text-meta m-0 mt-1">
              所有项目卡片，按最近更新倒序。
            </p>
          </div>
          <Button variant="primary">[ New Project ]</Button>
        </div>

        {projects.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-10 text-meta">
            <SpriteIcon size={32} />
            <p className="font-sans text-[13px] m-0">No projects yet — create one to begin.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {projects.map((p) => (
              <Card
                key={p.id}
                variant="agent"
                data-testid="project-card"
                className="hover:border-l-accent-soft"
              >
                <div className="flex justify-between items-center">
                  <Link
                    to={`/projects/${p.id}`}
                    className="font-semibold text-[14px] text-heading no-underline hover:text-accent"
                  >
                    {p.name}
                  </Link>
                  <Chip variant={p.status}>{p.status}</Chip>
                </div>
                <div className="font-mono-term text-[11px] text-meta tracking-[0.04em]">
                  UPDATED {p.updatedAt}
                </div>
              </Card>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
```

If `App.tsx` currently wraps pages without a global nav, this task keeps `TopNav` inside the page (consistent with mockup). Do not add nav twice.

- [ ] **Step 5: Run — PASS. Commit.**

```bash
git add packages/web-ui/src/pages/ProjectList.tsx packages/web-ui/tests/pages/project-list.test.tsx
git commit -m "sp14(T12): restyle ProjectList with new primitives + TopNav"
```

---

<!-- PART2_MARKER -->

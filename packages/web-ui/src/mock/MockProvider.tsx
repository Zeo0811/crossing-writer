import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { HERO_PROJECT_ID, mockProjects, type HeroStatus, type MockProject } from "./fixtures/projects";

export type Theme = "dark" | "light";
export type CliHealth = "ok" | "slow" | "down";

export interface MockToast {
  id: number;
  type: "success" | "error" | "info";
  message: string;
}

interface MockState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  cliHealth: CliHealth;
  setCliHealth: (h: CliHealth) => void;
  heroStatus: HeroStatus;
  setHeroStatus: (s: HeroStatus) => void;
  projects: MockProject[];
  hero: MockProject;
  toasts: MockToast[];
  pushToast: (t: Omit<MockToast, "id">) => void;
  dismissToast: (id: number) => void;
  paletteOpen: boolean;
  setPaletteOpen: (b: boolean) => void;
  switcherOpen: boolean;
  setSwitcherOpen: (b: boolean) => void;
}

const Ctx = createContext<MockState | null>(null);

const THEME_KEY = "crossing_theme";

export function MockProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = typeof window !== "undefined" ? (localStorage.getItem(THEME_KEY) as Theme | null) : null;
    return stored === "light" || stored === "dark" ? stored : "dark";
  });
  const [cliHealth, setCliHealth] = useState<CliHealth>("ok");
  const [heroStatus, setHeroStatusInner] = useState<HeroStatus>("created");
  const [toasts, setToasts] = useState<MockToast[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [nextId, setNextId] = useState(1);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => setThemeState(t), []);
  const toggleTheme = useCallback(() => setThemeState((t) => (t === "dark" ? "light" : "dark")), []);

  const pushToast = useCallback((t: Omit<MockToast, "id">) => {
    const id = nextId;
    setNextId((n) => n + 1);
    setToasts((prev) => [...prev, { ...t, id }].slice(-5));
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 4000);
  }, [nextId]);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const setHeroStatus = useCallback((s: HeroStatus) => {
    setHeroStatusInner(s);
  }, []);

  const projects = useMemo(() => {
    return mockProjects.map((p) => (p.id === HERO_PROJECT_ID ? { ...p, status: heroStatus } : p));
  }, [heroStatus]);

  const hero = useMemo(() => projects.find((p) => p.id === HERO_PROJECT_ID)!, [projects]);

  // Global ⌘K
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
      if (e.key === "Escape") setPaletteOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const value: MockState = {
    theme, setTheme, toggleTheme,
    cliHealth, setCliHealth,
    heroStatus, setHeroStatus,
    projects, hero,
    toasts, pushToast, dismissToast,
    paletteOpen, setPaletteOpen,
    switcherOpen, setSwitcherOpen,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMock() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useMock must be used inside MockProvider");
  return ctx;
}

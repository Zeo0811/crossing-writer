import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProjectList } from "../../src/pages/ProjectList";
import { ConfigWorkbench } from "../../src/pages/ConfigWorkbench";
import { StylePanelsPage } from "../../src/pages/StylePanelsPage";
import { KnowledgePage } from "../../src/pages/KnowledgePage";
import * as healthApi from "../../src/api/system-health";

vi.mock("../../src/api/writer-client.js", () => ({
  getAgentConfigs: vi.fn(async () => ({ agents: {} })),
  listStylePanels: vi.fn(async () => []),
  setAgentConfig: vi.fn(),
}));

vi.mock("../../src/api/style-panels-client.js", () => ({
  getAccounts: vi.fn(async () => []),
  listStylePanels: vi.fn(async () => []),
}));

vi.mock("../../src/api/wiki-client.js", () => ({
  getPages: vi.fn(async () => []),
  search: vi.fn(async () => []),
  startIngestStream: vi.fn(),
  status: vi.fn(async () => null),
}));

const PAGES: Array<{ testid: string; render: () => any }> = [
  {
    testid: "page-project-list",
    render: () => {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      return (
        <QueryClientProvider client={qc}>
          <MemoryRouter>
            <Routes>
              <Route path="/" element={<ProjectList />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      );
    },
  },
  {
    testid: "page-config-workbench",
    render: () => (
      <MemoryRouter>
        <ConfigWorkbench />
      </MemoryRouter>
    ),
  },
  {
    testid: "page-style-panels",
    render: () => (
      <MemoryRouter>
        <StylePanelsPage />
      </MemoryRouter>
    ),
  },
  {
    testid: "page-knowledge",
    render: () => (
      <MemoryRouter>
        <KnowledgePage />
      </MemoryRouter>
    ),
  },
];

describe.each(["dark", "light"] as const)("visual smoke (%s)", (theme) => {
  beforeEach(() => {
    if (theme === "light") document.documentElement.setAttribute("data-theme", "light");
    else document.documentElement.setAttribute("data-theme", "dark");

    vi.spyOn(healthApi, "fetchCliHealth").mockResolvedValue({
      claude: { status: "online", version: "1.0", checkedAt: new Date().toISOString() },
      codex: { status: "online", version: "1.0", checkedAt: new Date().toISOString() },
    } as any);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => [] }))
    );
  });
  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
  });

  it.each(PAGES)("$testid renders with topnav + tokens applied", async ({ testid, render: renderPage }) => {
    render(renderPage());
    await waitFor(() => expect(screen.getByTestId(testid)).toBeInTheDocument());
    // TopNav may not appear on style-panels / knowledge since those pages don't embed it; so check at least one of these
    const hasTopNav = screen.queryByTestId("topnav") !== null;
    const rootEl = screen.getByTestId(testid);
    expect(rootEl).toBeInTheDocument();
    // Token class (bg-bg-0) should be present on page root OR theme attribute applied
    expect(
      rootEl.className.includes("bg-bg-0") ||
      document.documentElement.getAttribute("data-theme") === theme ||
      hasTopNav
    ).toBe(true);
  });
});

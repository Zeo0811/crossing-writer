import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProjectList } from "../../src/pages/ProjectList";
import * as healthApi from "../../src/api/system-health";

describe("ProjectList restyle", () => {
  beforeEach(() => {
    vi.spyOn(healthApi, "fetchCliHealth").mockResolvedValue({
      claude: { status: "online", version: "1.0", checkedAt: "2026-04-14T00:00:00Z" },
      codex: { status: "online", version: "1.0", checkedAt: "2026-04-14T00:00:00Z" },
    } as any);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.startsWith("/api/projects")) {
        return {
          ok: true,
          json: async () => [
            { id: "p1", name: "ghostty-as-craft", stage: "draft", status: "active", updated_at: "2026-04-12T00:00:00Z" },
          ],
        };
      }
      return { ok: true, json: async () => ({}) };
    }));
  });

  it("renders TopNav and page-project-list testid", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <ProjectList />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("page-project-list")).toBeInTheDocument();
    expect(screen.getByTestId("topnav")).toBeInTheDocument();
  });

  it("shows sprite empty state when no projects", async () => {
    vi.spyOn(healthApi, "fetchCliHealth").mockResolvedValue({
      claude: { status: "online", version: "1.0", checkedAt: "2026-04-14T00:00:00Z" },
      codex: { status: "online", version: "1.0", checkedAt: "2026-04-14T00:00:00Z" },
    } as any);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => [] })));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <ProjectList />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText(/no projects yet/i)).toBeInTheDocument());
  });
});

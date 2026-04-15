import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { ProjectList } from "../../src/pages/ProjectList";
import * as healthApi from "../../src/api/system-health";

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

function jsonRes(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map([["content-type", "application/json"]]),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as any;
}

describe("ProjectList tabs", () => {
  beforeEach(() => {
    vi.spyOn(healthApi, "fetchCliHealth").mockResolvedValue({
      claude: { status: "online", version: "1.0", checkedAt: "2026-04-14T00:00:00Z" },
      codex: { status: "online", version: "1.0", checkedAt: "2026-04-14T00:00:00Z" },
    } as any);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "/api/projects") {
        return jsonRes({
          items: [
            {
              id: "act1",
              name: "Active One",
              slug: "active-one",
              status: "created",
              stage: "intake",
              updated_at: new Date().toISOString(),
            },
          ],
          archived_count: 2,
        });
      }
      if (url === "/api/projects?only_archived=1") {
        return jsonRes({
          items: [
            {
              id: "arc1",
              name: "Arch One",
              slug: "arch-one",
              status: "created",
              stage: "intake",
              updated_at: new Date().toISOString(),
            },
            {
              id: "arc2",
              name: "Arch Two",
              slug: "arch-two",
              status: "created",
              stage: "intake",
              updated_at: new Date().toISOString(),
            },
          ],
          active_count: 1,
        });
      }
      return jsonRes({});
    }));
  });

  it("shows active items by default with badge counts", async () => {
    wrap(<ProjectList />);
    await waitFor(() => expect(screen.getByText("Active One")).toBeInTheDocument());
    expect(screen.getByTestId("tab-active")).toHaveTextContent("进行中");
    expect(screen.getByTestId("tab-active")).toHaveTextContent("1");
    expect(screen.getByTestId("tab-archived")).toHaveTextContent("已归档");
    expect(screen.getByTestId("tab-archived")).toHaveTextContent("2");
  });

  it("switching to archived tab shows archived projects", async () => {
    wrap(<ProjectList />);
    await waitFor(() => expect(screen.getByText("Active One")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("tab-archived"));
    await waitFor(() => expect(screen.getByText("Arch One")).toBeInTheDocument());
    expect(screen.getByText("Arch Two")).toBeInTheDocument();
  });

  it("active card ⋯ menu shows 归档 and 硬删", async () => {
    wrap(<ProjectList />);
    await waitFor(() => expect(screen.getByText("Active One")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("card-menu-btn-act1"));
    expect(screen.getByText("归档")).toBeInTheDocument();
    expect(screen.getByText("硬删")).toBeInTheDocument();
  });
});

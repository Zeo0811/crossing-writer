import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProjectList } from "../../src/pages/ProjectList";
import * as healthApi from "../../src/api/system-health";

describe("ProjectList CLI health indicator", () => {
  beforeEach(() => {
    vi.spyOn(healthApi, "fetchCliHealth").mockResolvedValue({
      claude: { status: "online", version: "1.4.2", checkedAt: "2026-04-14T00:00:00Z" },
      codex: { status: "offline", error: "command not found", checkedAt: "2026-04-14T00:00:00Z" },
    } as any);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => [] })));
  });

  it("shows both CLI dots in top nav", async () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <ProjectList />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByLabelText(/CLAUDE online/i)).toBeInTheDocument());
    expect(screen.getByLabelText(/CODEX offline/i)).toBeInTheDocument();
  });
});

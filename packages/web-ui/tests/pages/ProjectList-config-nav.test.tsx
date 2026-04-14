import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProjectList } from "../../src/pages/ProjectList";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.startsWith("/api/projects")) {
      return { ok: true, json: async () => [] };
    }
    return { ok: true, json: async () => ({}) };
  }));
});

function renderWithRouter(initial = "/") {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/" element={<ProjectList />} />
          <Route path="/config" element={<div>配置工作台页面</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ProjectList top-nav config workbench entry", () => {
  it("shows 配置工作台 link in the header", () => {
    renderWithRouter("/");
    const link = screen.getByRole("link", { name: /配置工作台/ });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/config");
  });
});

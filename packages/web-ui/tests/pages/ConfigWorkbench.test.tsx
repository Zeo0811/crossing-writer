import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../src/api/writer-client.js", () => ({
  getAgentConfigs: vi.fn(async () => ({ agents: {} })),
  setAgentConfig: vi.fn(async () => {}),
  listConfigStylePanels: vi.fn(async () => ({ panels: [] })),
}));

import { ConfigWorkbench } from "../../src/pages/ConfigWorkbench";

function renderPage() {
  return render(
    <MemoryRouter>
      <ConfigWorkbench />
    </MemoryRouter>,
  );
}

describe("ConfigWorkbench page shell", () => {
  it("renders the page with both tab labels", () => {
    renderPage();
    expect(screen.getByRole("tab", { name: /主流程/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /蒸馏/ })).toBeInTheDocument();
  });

  it("defaults to the 主流程 tab rendering AgentsPanel", () => {
    renderPage();
    expect(screen.queryByText(/StylePanelList placeholder/i)).not.toBeInTheDocument();
  });

  it("switches to 蒸馏 tab when clicked", () => {
    renderPage();
    fireEvent.click(screen.getByRole("tab", { name: /蒸馏/ }));
    expect(screen.getByText(/StylePanelList placeholder/i)).toBeInTheDocument();
  });

  it("marks the active tab with aria-selected", () => {
    renderPage();
    const mainTab = screen.getByRole("tab", { name: /主流程/ });
    const distillTab = screen.getByRole("tab", { name: /蒸馏/ });
    expect(mainTab).toHaveAttribute("aria-selected", "true");
    expect(distillTab).toHaveAttribute("aria-selected", "false");
    fireEvent.click(distillTab);
    expect(mainTab).toHaveAttribute("aria-selected", "false");
    expect(distillTab).toHaveAttribute("aria-selected", "true");
  });
});

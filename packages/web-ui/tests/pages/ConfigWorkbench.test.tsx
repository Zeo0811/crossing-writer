import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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

  it("defaults to the 主流程 tab showing AgentsPanel placeholder", () => {
    renderPage();
    expect(screen.getByText(/AgentsPanel placeholder/i)).toBeInTheDocument();
    expect(screen.queryByText(/StylePanelList placeholder/i)).not.toBeInTheDocument();
  });

  it("switches to 蒸馏 tab when clicked", () => {
    renderPage();
    fireEvent.click(screen.getByRole("tab", { name: /蒸馏/ }));
    expect(screen.getByText(/StylePanelList placeholder/i)).toBeInTheDocument();
    expect(screen.queryByText(/AgentsPanel placeholder/i)).not.toBeInTheDocument();
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

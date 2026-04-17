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
    try { localStorage.removeItem("crossing_theme"); } catch {}
    document.documentElement.removeAttribute("data-theme");
  });

  it("renders pixel logo, version, and nav links", () => {
    renderNav();
    expect(screen.getByText("CROSSING.WRITER")).toBeInTheDocument();
    expect(screen.getByText("v0.14")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /projects/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "风格面板" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "硬规则" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "选题专家" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "配置" })).toBeInTheDocument();
  });

  it("theme toggle flips data-theme and swaps glyph", () => {
    renderNav();
    const btn = screen.getByRole("button", { name: /toggle theme/i });
    expect(btn.textContent).toBe("☾");
    fireEvent.click(btn);
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(btn.textContent).toBe("☼");
  });

  it("renders breadcrumb when provided", () => {
    render(
      <MemoryRouter>
        <TopNav breadcrumb={["projects", "demo"]} />
      </MemoryRouter>
    );
    const bc = screen.getByTestId("topnav-breadcrumb");
    expect(bc.textContent).toMatch(/projects/);
    expect(bc.textContent).toMatch(/demo/);
  });
});

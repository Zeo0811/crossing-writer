import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { ProjectChecklist, type ChecklistItem } from "../../src/components/project/ProjectChecklist";

const ITEMS: ChecklistItem[] = [
  { step: "brief", status: "done" },
  { step: "topic", status: "todo" },
  { step: "case", status: "partial" },
  { step: "evidence", status: "warning" },
  { step: "styleBindings", status: "blocked", reason: "r" },
  { step: "draft", status: "todo" },
  { step: "review", status: "todo" },
];

describe("ProjectChecklist theme tokens (SP-14 polish)", () => {
  it("chip className does not embed raw hex color", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const cssPath = resolve(here, "../../src/components/project/ProjectChecklist.css");
    const css = readFileSync(cssPath, "utf-8");
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    // uses design tokens via var(--...)
    expect(css).toMatch(/var\(--accent\)/);
    expect(css).toMatch(/var\(--red\)/);
    expect(css).toMatch(/var\(--amber/);
    expect(css).toMatch(/var\(--meta\)/);
  });

  it("renders chips with matching data-status in dark theme", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    render(<ProjectChecklist items={ITEMS} />);
    const blocked = screen.getByTestId("checklist-chip-styleBindings");
    expect(blocked.getAttribute("data-status")).toBe("blocked");
    expect(blocked.className).toMatch(/checklist-chip/);
    document.documentElement.removeAttribute("data-theme");
  });
});

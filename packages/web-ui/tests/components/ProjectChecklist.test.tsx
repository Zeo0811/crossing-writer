import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProjectChecklist, type ChecklistItem } from "../../src/components/project/ProjectChecklist";

const ITEMS: ChecklistItem[] = [
  { step: "brief", status: "done", link: "brief" },
  { step: "topic", status: "todo", link: "mission" },
  { step: "case", status: "partial", reason: "draft 状态", link: "case" },
  { step: "evidence", status: "todo", link: "evidence" },
  { step: "styleBindings", status: "blocked", reason: "writer.practice 缺少 styleBinding", link: "config" },
  { step: "draft", status: "todo", link: "article" },
  { step: "review", status: "todo", link: "article" },
];

describe("ProjectChecklist", () => {
  it("renders all 7 chips with correct data-status", () => {
    render(<ProjectChecklist items={ITEMS} />);
    for (const it of ITEMS) {
      const chip = screen.getByTestId(`checklist-chip-${it.step}`);
      expect(chip.getAttribute("data-status")).toBe(it.status);
    }
  });

  it("shows reason via title attribute", () => {
    render(<ProjectChecklist items={ITEMS} />);
    expect(
      screen.getByTestId("checklist-chip-styleBindings").getAttribute("title"),
    ).toContain("writer.practice");
  });

  it("fires onChipClick with the item payload", () => {
    const onChipClick = vi.fn();
    render(<ProjectChecklist items={ITEMS} onChipClick={onChipClick} />);
    fireEvent.click(screen.getByTestId("checklist-chip-case"));
    expect(onChipClick).toHaveBeenCalledWith(expect.objectContaining({ step: "case", link: "case" }));
  });

  it("collapsed view shows summary pill and no chips", () => {
    render(<ProjectChecklist items={ITEMS} collapsed />);
    expect(screen.getByTestId("checklist-summary").textContent).toContain("1/7");
    expect(screen.queryByTestId("checklist-chip-brief")).toBeNull();
  });

  it("toggle button triggers onToggleCollapsed", () => {
    const onToggle = vi.fn();
    render(<ProjectChecklist items={ITEMS} onToggleCollapsed={onToggle} />);
    fireEvent.click(screen.getByTestId("checklist-toggle"));
    expect(onToggle).toHaveBeenCalledOnce();
  });
});

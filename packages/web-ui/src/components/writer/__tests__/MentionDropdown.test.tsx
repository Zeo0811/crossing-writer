import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MentionDropdown, SKILL_ITEMS, type MentionSkillItem } from "../MentionDropdown.js";

describe("MentionDropdown", () => {
  it("renders nothing when items is empty", () => {
    const { container } = render(
      <MentionDropdown items={[]} activeIndex={0} onSelect={() => {}} onHover={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders exactly 2 static skill rows with icon/label/description", () => {
    render(
      <MentionDropdown items={SKILL_ITEMS} activeIndex={0} onSelect={() => {}} onHover={() => {}} />,
    );
    const row0 = screen.getByTestId("mention-row-0");
    expect(row0.textContent).toContain("🔖");
    expect(row0.textContent).toContain("search_wiki");
    expect(row0.textContent).toContain("Wiki");

    const row1 = screen.getByTestId("mention-row-1");
    expect(row1.textContent).toContain("🗞️");
    expect(row1.textContent).toContain("search_raw");
    expect(row1.textContent).toContain("原始文章库");

    expect(screen.queryByTestId("mention-row-2")).toBeNull();
  });

  it("SKILL_ITEMS carries the literal insert text with trailing space", () => {
    expect(SKILL_ITEMS[0]!.insertText).toBe("@search_wiki ");
    expect(SKILL_ITEMS[1]!.insertText).toBe("@search_raw ");
  });

  it("active row gets aria-selected=true and others false", () => {
    render(
      <MentionDropdown items={SKILL_ITEMS} activeIndex={1} onSelect={() => {}} onHover={() => {}} />,
    );
    expect(screen.getByTestId("mention-row-0").getAttribute("aria-selected")).toBe("false");
    expect(screen.getByTestId("mention-row-1").getAttribute("aria-selected")).toBe("true");
  });

  it("click fires onSelect with the clicked item", () => {
    const onSelect = vi.fn();
    render(
      <MentionDropdown items={SKILL_ITEMS} activeIndex={0} onSelect={onSelect} onHover={() => {}} />,
    );
    fireEvent.click(screen.getByTestId("mention-row-1"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect((onSelect.mock.calls[0]![0] as MentionSkillItem).key).toBe("search_raw");
  });

  it("mousemove fires onHover with the row index", () => {
    const onHover = vi.fn();
    render(
      <MentionDropdown items={SKILL_ITEMS} activeIndex={0} onSelect={() => {}} onHover={onHover} />,
    );
    fireEvent.mouseMove(screen.getByTestId("mention-row-1"));
    expect(onHover).toHaveBeenCalledWith(1);
  });
});

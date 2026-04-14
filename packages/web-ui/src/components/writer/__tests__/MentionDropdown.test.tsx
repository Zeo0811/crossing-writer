import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MentionDropdown } from "../MentionDropdown.js";
import type { SuggestItem } from "../../../api/writer-client.js";

const wikiItem: SuggestItem = {
  kind: "wiki",
  id: "w1",
  title: "Wiki Title",
  excerpt: "This is a short wiki excerpt that should be shown.",
};

const longExcerpt = "A".repeat(80);
const wikiLong: SuggestItem = {
  kind: "wiki",
  id: "w2",
  title: "Long",
  excerpt: longExcerpt,
};

const rawItem: SuggestItem = {
  kind: "raw",
  id: "r1",
  title: "Raw Title",
  excerpt: "raw excerpt",
  account: "acct-a",
  published_at: "2026-04-01",
};

describe("MentionDropdown", () => {
  it("renders nothing when items is empty", () => {
    const { container } = render(
      <MentionDropdown items={[]} activeIndex={0} onSelect={() => {}} onHover={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders wiki row with [wiki] prefix and truncated excerpt", () => {
    render(
      <MentionDropdown
        items={[wikiItem, wikiLong]}
        activeIndex={0}
        onSelect={() => {}}
        onHover={() => {}}
      />,
    );
    const row0 = screen.getByTestId("mention-row-0");
    expect(row0.textContent).toContain("[wiki]");
    expect(row0.textContent).toContain("Wiki Title");
    expect(row0.textContent).toContain("This is a short wiki excerpt that should be shown.");

    const row1 = screen.getByTestId("mention-row-1");
    // truncated to 60 chars
    expect(row1.textContent).toContain("A".repeat(60));
    expect(row1.textContent).not.toContain("A".repeat(61));
  });

  it("renders raw row with [raw] published_at · account · title", () => {
    render(
      <MentionDropdown items={[rawItem]} activeIndex={0} onSelect={() => {}} onHover={() => {}} />,
    );
    const row = screen.getByTestId("mention-row-0");
    expect(row.textContent).toContain("[raw]");
    expect(row.textContent).toContain("2026-04-01");
    expect(row.textContent).toContain("acct-a");
    expect(row.textContent).toContain("Raw Title");
  });

  it("active row gets aria-selected=true and others false", () => {
    render(
      <MentionDropdown
        items={[wikiItem, rawItem]}
        activeIndex={1}
        onSelect={() => {}}
        onHover={() => {}}
      />,
    );
    expect(screen.getByTestId("mention-row-0").getAttribute("aria-selected")).toBe("false");
    expect(screen.getByTestId("mention-row-1").getAttribute("aria-selected")).toBe("true");
  });

  it("click fires onSelect with the clicked item", () => {
    const onSelect = vi.fn();
    render(
      <MentionDropdown
        items={[wikiItem, rawItem]}
        activeIndex={0}
        onSelect={onSelect}
        onHover={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("mention-row-1"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(rawItem);
  });

  it("mousemove fires onHover with the row index", () => {
    const onHover = vi.fn();
    render(
      <MentionDropdown
        items={[wikiItem, rawItem]}
        activeIndex={0}
        onSelect={() => {}}
        onHover={onHover}
      />,
    );
    fireEvent.mouseMove(screen.getByTestId("mention-row-1"));
    expect(onHover).toHaveBeenCalledWith(1);
  });

  it("renders at most 12 rows", () => {
    const many: SuggestItem[] = Array.from({ length: 20 }, (_, i) => ({
      kind: "wiki",
      id: `w${i}`,
      title: `T${i}`,
      excerpt: "x",
    }));
    render(
      <MentionDropdown items={many} activeIndex={0} onSelect={() => {}} onHover={() => {}} />,
    );
    expect(screen.queryByTestId("mention-row-11")).not.toBeNull();
    expect(screen.queryByTestId("mention-row-12")).toBeNull();
  });
});

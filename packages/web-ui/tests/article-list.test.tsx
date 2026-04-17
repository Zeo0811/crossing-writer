import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ArticleList } from "../src/components/wiki/ArticleList";

const articles = [
  { id: "A0", title: "AAA", published_at: "2026-04-15", ingest_status: "raw", word_count: 100 },
  { id: "A1", title: "BBB", published_at: "2026-04-14", ingest_status: "topics_tagged", word_count: 200 },
];

describe("ArticleList", () => {
  it("renders rows with title/date/wordcount", () => {
    render(<ArticleList articles={articles} duplicates={new Set()} selectedIds={new Set()} onToggle={() => {}} />);
    expect(screen.getByText("AAA")).toBeInTheDocument();
    expect(screen.getByText("BBB")).toBeInTheDocument();
    expect(screen.getByText("2026-04-15")).toBeInTheDocument();
  });

  it("shows checkbox checked for selectedIds", () => {
    render(<ArticleList articles={articles} duplicates={new Set()} selectedIds={new Set(["A0"])} onToggle={() => {}} />);
    const checkedBtn = screen.getByTestId("article-row-A0");
    expect(checkedBtn).toHaveAttribute("aria-pressed", "true");
    const unchecked = screen.getByTestId("article-row-A1");
    expect(unchecked).toHaveAttribute("aria-pressed", "false");
  });

  it("marks duplicates with badge and disables row", () => {
    render(<ArticleList articles={articles} duplicates={new Set(["A0"])} selectedIds={new Set()} onToggle={() => {}} />);
    expect(screen.getByTestId("article-row-A0")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(/已入库/)).toBeInTheDocument();
  });

  it("onToggle fires for non-duplicate click", () => {
    const onToggle = vi.fn();
    render(<ArticleList articles={articles} duplicates={new Set()} selectedIds={new Set()} onToggle={onToggle} />);
    fireEvent.click(screen.getByTestId("article-row-A0"));
    expect(onToggle).toHaveBeenCalledWith("A0");
  });

  it("onToggle NOT fired when clicking duplicate row", () => {
    const onToggle = vi.fn();
    render(<ArticleList articles={articles} duplicates={new Set(["A0"])} selectedIds={new Set()} onToggle={onToggle} />);
    fireEvent.click(screen.getByTestId("article-row-A0"));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("renders empty state when articles is empty", () => {
    render(<ArticleList articles={[]} duplicates={new Set()} selectedIds={new Set()} onToggle={() => {}} />);
    expect(screen.getByText(/无文章/)).toBeInTheDocument();
  });
});

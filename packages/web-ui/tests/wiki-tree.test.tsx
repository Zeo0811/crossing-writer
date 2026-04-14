import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WikiTree } from "../src/components/wiki/WikiTree";
import type { WikiPageMeta } from "../src/api/wiki-client";

const pages: WikiPageMeta[] = [
  { path: "entities/Alice.md", kind: "entity", title: "Alice", aliases: [], sources_count: 1, backlinks_count: 0 },
  { path: "entities/Bob.md", kind: "entity", title: "Bob", aliases: [], sources_count: 1, backlinks_count: 0 },
  { path: "concepts/RAG.md", kind: "concept", title: "RAG", aliases: [], sources_count: 1, backlinks_count: 0 },
];

describe("WikiTree", () => {
  it("groups pages by kind with counts", () => {
    render(<WikiTree pages={pages} selected={null} onSelect={() => {}} />);
    expect(screen.getByText(/entity \(2\)/)).toBeInTheDocument();
    expect(screen.getByText(/concept \(1\)/)).toBeInTheDocument();
  });

  it("clicks a page invokes onSelect", () => {
    const onSelect = vi.fn();
    render(<WikiTree pages={pages} selected={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("Alice"));
    expect(onSelect).toHaveBeenCalledWith("entities/Alice.md");
  });

  it("toggles a kind group", () => {
    render(<WikiTree pages={pages} selected={null} onSelect={() => {}} />);
    const header = screen.getByText(/entity \(2\)/);
    fireEvent.click(header);
    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
    fireEvent.click(header);
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });
});

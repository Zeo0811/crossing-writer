import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { IngestCartBar } from "../src/components/wiki/IngestCartBar";
import type { CartEntry } from "../src/hooks/useIngestCart";

const entries: CartEntry[] = [
  { articleId: "A0", account: "AcctA", title: "t0", publishedAt: "2026-04-15", wordCount: 100 },
  { articleId: "A1", account: "AcctA", title: "t1", publishedAt: "2026-04-14", wordCount: 200 },
  { articleId: "B0", account: "AcctB", title: "tB0", publishedAt: "2026-04-13", wordCount: 300 },
];

describe("IngestCartBar", () => {
  it("shows count + account breakdown + total words", () => {
    render(<IngestCartBar entries={entries} maxArticles={50} onClear={() => {}} onSubmit={() => {}} />);
    expect(screen.getByText(/已选 3 篇/)).toBeInTheDocument();
    expect(screen.getByText(/AcctA 2/)).toBeInTheDocument();
    expect(screen.getByText(/AcctB 1/)).toBeInTheDocument();
    expect(screen.getByText(/600/)).toBeInTheDocument();
  });

  it("submit button disabled when empty", () => {
    render(<IngestCartBar entries={[]} maxArticles={50} onClear={() => {}} onSubmit={() => {}} />);
    expect(screen.getByRole("button", { name: /入库/ })).toBeDisabled();
  });

  it("exceeds max shows warning + disabled submit", () => {
    render(<IngestCartBar entries={entries} maxArticles={2} onClear={() => {}} onSubmit={() => {}} />);
    expect(screen.getByText(/超上限|超过/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /入库/ })).toBeDisabled();
  });

  it("clear clicks onClear", () => {
    const onClear = vi.fn();
    render(<IngestCartBar entries={entries} maxArticles={50} onClear={onClear} onSubmit={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /清空/ }));
    expect(onClear).toHaveBeenCalled();
  });

  it("submit clicks onSubmit", () => {
    const onSubmit = vi.fn();
    render(<IngestCartBar entries={entries} maxArticles={50} onClear={() => {}} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: /入库/ }));
    expect(onSubmit).toHaveBeenCalled();
  });
});

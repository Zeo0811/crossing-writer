import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { WikiPagePreview } from "../src/components/wiki/WikiPagePreview";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => "---\ntype: entity\ntitle: Alice\n---\n# Alice\n\nResearcher" }));
});

describe("WikiPagePreview", () => {
  it("fetches and renders markdown", async () => {
    render(<WikiPagePreview path="entities/Alice.md" />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Alice" })).toBeInTheDocument());
    expect(screen.getByText("Researcher")).toBeInTheDocument();
  });

  it("shows placeholder when path is null", () => {
    render(<WikiPagePreview path={null} />);
    expect(screen.getByText(/select a page/i)).toBeInTheDocument();
  });
});

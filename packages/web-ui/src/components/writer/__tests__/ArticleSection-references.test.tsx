import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../api/writer-client", async () => {
  const actual = await vi.importActual<any>("../../../api/writer-client");
  return {
    ...actual,
    getSections: vi.fn(async () => ({
      sections: [
        {
          key: "opening",
          frontmatter: {
            section: "opening",
            last_agent: "writer.opening",
            last_updated_at: "t",
            tools_used: [
              { tool: "search_raw", round: 1, hits_count: 3, query: "x", args: {}, pinned_by: "auto", hits_summary: [] },
            ],
          },
          preview: "p",
        },
      ],
    })),
    getFinal: vi.fn(async () => "---\n---\n<!-- section:opening -->\n开头 body"),
    rewriteSectionStream: vi.fn(),
    getPinned: vi.fn(async () => ({
      pins: [
        { ok: true, tool: "search_raw", query: "q", args: {}, hits: [], hits_count: 0, formatted: "pinned-A content", pinned_by: "manual:user" },
      ],
    })),
  };
});

vi.mock("../../../hooks/useProjectStream", () => ({
  useProjectStream: () => ({ events: [] }),
}));

import { ArticleSection } from "../ArticleSection";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ArticleSection references panel", () => {
  it("renders tools_used from frontmatter and pinned items merged", async () => {
    render(<ArticleSection projectId="p1" status="writing_ready" />);
    const buttons = await screen.findAllByRole("button", { name: /本段引用/ });
    expect(buttons.length).toBeGreaterThan(0);
    fireEvent.click(buttons[0]!);
    await waitFor(() => {
      expect(screen.getByText(/search_raw/)).toBeInTheDocument();
      expect(screen.getByText(/pinned-A/)).toBeInTheDocument();
    });
  });

  it("shows empty hint when no references", async () => {
    const client = await import("../../../api/writer-client");
    (client.getSections as any).mockResolvedValueOnce({
      sections: [
        {
          key: "opening",
          frontmatter: { section: "opening", last_agent: "w", last_updated_at: "t" },
          preview: "p",
        },
      ],
    });
    (client.getPinned as any).mockResolvedValueOnce({ pins: [] });

    render(<ArticleSection projectId="p2" status="writing_ready" />);
    const buttons = await screen.findAllByRole("button", { name: /本段引用/ });
    fireEvent.click(buttons[0]!);
    await waitFor(() => {
      expect(screen.getByText(/暂无引用/)).toBeInTheDocument();
    });
  });
});

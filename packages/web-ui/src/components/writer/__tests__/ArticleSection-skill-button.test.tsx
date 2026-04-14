import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../../api/writer-client", () => ({
  getSections: vi.fn(async () => ({
    sections: [
      {
        key: "opening",
        frontmatter: { section: "opening", last_agent: "w", last_updated_at: "t" },
        preview: "p",
      },
    ],
  })),
  getFinal: vi.fn(async () => "---\n---\n<!-- section:opening -->\n开头 body"),
  getPinned: vi.fn().mockResolvedValue({ pins: [] }),
  callSkill: vi.fn(),
  deletePin: vi.fn(),
  putSection: vi.fn(),
  rewriteSectionStream: vi.fn(),
}));

vi.mock("../../../hooks/useProjectStream", () => ({
  useProjectStream: () => ({ events: [] }),
}));

import { ArticleSection } from "../ArticleSection";

describe("ArticleSection skill button", () => {
  it("opens SkillForm when [🔧 @skill] is clicked", async () => {
    render(<ArticleSection projectId="p1" status="writing_ready" />);
    const btn = await screen.findByRole("button", { name: /@skill/ });
    fireEvent.click(btn);
    expect(screen.getByText(/调用工具/)).toBeInTheDocument();
  });
});

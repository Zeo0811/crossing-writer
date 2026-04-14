import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../src/api/writer-client", () => ({
  getSections: vi.fn(async () => ({ sections: [
    { key: "opening", frontmatter: { section: "opening", last_agent: "writer.opening", last_updated_at: "2026-04-14T12:00:00Z" }, preview: "p" },
    { key: "practice.case-01", frontmatter: { section: "practice.case-01", last_agent: "human", last_updated_at: "t" }, preview: "q" },
    { key: "closing", frontmatter: { section: "closing", last_agent: "writer.closing", last_updated_at: "t" }, preview: "r" },
  ]})),
  getFinal: vi.fn(async () => "---\n---\n<!-- section:opening -->\n开头 body\n<!-- section:practice.case-01 -->\ncase1 body\n<!-- section:closing -->\n结尾 body"),
  rewriteSectionStream: vi.fn(),
}));
vi.mock("../../../src/hooks/useProjectStream", () => ({ useProjectStream: () => ({ events: [] }) }));

import { ArticleSection } from "../../../src/components/writer/ArticleSection";

describe("ArticleSection left panel", () => {
  it("evidence_ready shows waiting hint", () => {
    render(<ArticleSection projectId="pid" status="evidence_ready" />);
    expect(screen.getByText(/在右栏配置/)).toBeTruthy();
  });

  it("writing_ready shows section tree with opening / practice / closing", async () => {
    const { findAllByText, getByText } = render(<ArticleSection projectId="pid" status="writing_ready" />);
    expect((await findAllByText(/开头/)).length).toBeGreaterThan(0);
    expect((await findAllByText(/case-01/)).length).toBeGreaterThan(0);
    expect((await findAllByText(/结尾/)).length).toBeGreaterThan(0);
    expect(getByText(/human/)).toBeTruthy();
  });
});

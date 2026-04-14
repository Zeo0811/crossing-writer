import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../src/api/writer-client", () => ({
  getSections: vi.fn(async () => ({ sections: [
    { key: "opening", frontmatter: { section: "opening", last_agent: "writer.opening", last_updated_at: "t" }, preview: "p" },
  ]})),
  getFinal: vi.fn(async () => "---\n---\n<!-- section:opening -->\nhello world body"),
  getAgentConfigs: vi.fn(async () => ({ agents: {} })),
  getProjectOverride: vi.fn(async () => ({ agents: {} })),
  listConfigStylePanels: vi.fn(async () => ({ panels: [] })),
  rewriteSectionStream: vi.fn(),
  putSection: vi.fn(async () => {}),
  uploadImage: vi.fn(),
}));
vi.mock("../../../src/hooks/useProjectStream", () => ({ useProjectStream: () => ({ events: [] }) }));

import { ArticleSection } from "../../../src/components/writer/ArticleSection";

describe("SP-09 selection rewrite coexists with SP-13 edit mode (T11)", () => {
  it("render mode still renders a ReactMarkdown article container", async () => {
    render(<ArticleSection projectId="p1" status="writing_ready" />);
    const article = await screen.findByTestId("section-render-opening");
    expect(article).toBeTruthy();
  });

  it("edit mode removes ReactMarkdown container (scopes SP-09 off)", async () => {
    render(<ArticleSection projectId="p1" status="writing_ready" />);
    const toggle = await screen.findByTestId("edit-toggle-opening");
    fireEvent.click(toggle);
    await screen.findByRole("textbox");
    expect(screen.queryByTestId("section-render-opening")).toBeNull();
    // Toggle back
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByTestId("section-render-opening")).toBeTruthy());
  });
});

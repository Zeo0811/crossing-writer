import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

vi.mock("../../../src/api/writer-client", async () => ({
  getSections: vi.fn(async () => ({ sections: [
    { key: "opening", frontmatter: { section: "opening", last_agent: "writer.opening", last_updated_at: "t" }, preview: "p" },
  ]})),
  getFinal: vi.fn(async () => "---\n---\n<!-- section:opening -->\nhello body"),
  getAgentConfigs: vi.fn(async () => ({ agents: {} })),
  getProjectOverride: vi.fn(async () => ({ agents: {} })),
  listConfigStylePanels: vi.fn(async () => ({ panels: [] })),
  rewriteSectionStream: vi.fn(),
  putSection: vi.fn(async () => {}),
  uploadImage: vi.fn(),
}));
import * as writerClient from "../../../src/api/writer-client";
const putSectionMock = writerClient.putSection as unknown as ReturnType<typeof vi.fn>;
vi.mock("../../../src/hooks/useProjectStream", () => ({ useProjectStream: () => ({ events: [] }) }));

import { ArticleSection } from "../../../src/components/writer/ArticleSection";

describe("ArticleSection edit mode toggle (SP-13)", () => {
  beforeEach(() => {
    putSectionMock.mockClear();
    putSectionMock.mockResolvedValue(undefined);
  });

  it("click 编辑 shows textarea + hides rendered markdown", async () => {
    render(<ArticleSection projectId="p1" status="writing_ready" />);
    const btn = await screen.findByTestId("edit-toggle-opening");
    expect(btn.textContent).toMatch(/编辑/);
    fireEvent.click(btn);
    const ta = await screen.findByRole("textbox");
    expect(ta).toBeTruthy();
    expect(screen.queryByTestId("section-render-opening")).toBeNull();
    expect(btn.textContent).toMatch(/预览/);
  });

  it("click 预览 without editing returns to render mode without calling putSection", async () => {
    render(<ArticleSection projectId="p1" status="writing_ready" />);
    const btn = await screen.findByTestId("edit-toggle-opening");
    fireEvent.click(btn);
    await screen.findByRole("textbox");
    fireEvent.click(btn);
    await screen.findByTestId("section-render-opening");
    expect(putSectionMock).not.toHaveBeenCalled();
  });

  it("edit + save calls putSection with manual frontmatter and returns to render mode", async () => {
    render(<ArticleSection projectId="p1" status="writing_ready" />);
    fireEvent.click(await screen.findByTestId("edit-toggle-opening"));
    const ta = (await screen.findByRole("textbox")) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "updated body" } });
    await act(async () => {
      fireEvent.click(screen.getByText("保存"));
    });
    await waitFor(() => expect(putSectionMock).toHaveBeenCalled());
    const [pid, key, payload] = putSectionMock.mock.calls[0]!;
    expect(pid).toBe("p1");
    expect(key).toBe("opening");
    expect(payload.body).toBe("updated body");
    expect(payload.frontmatter.manually_edited).toBe(true);
    expect(payload.frontmatter.edit_history).toHaveLength(1);
    expect(payload.frontmatter.edit_history[0].kind).toBe("manual");
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
  });
});

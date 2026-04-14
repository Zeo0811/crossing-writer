import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";

vi.mock("../../../src/api/writer-client", () => ({
  getSections: vi.fn(async () => ({ sections: [
    { key: "opening", frontmatter: { section: "opening", last_agent: "writer.opening", last_updated_at: "t" }, preview: "p" },
  ]})),
  getFinal: vi.fn(async () => "---\n---\n<!-- section:opening -->\nold"),
  getAgentConfigs: vi.fn(async () => ({ agents: {} })),
  getProjectOverride: vi.fn(async () => ({ agents: {} })),
  listConfigStylePanels: vi.fn(async () => ({ panels: [] })),
  rewriteSectionStream: vi.fn(),
  putSection: vi.fn(async () => {}),
  uploadImage: vi.fn(async () => ({
    url: "/api/projects/p1/images/abc.png",
    filename: "abc.png",
    bytes: 3,
    mime: "image/png",
  })),
}));
vi.mock("../../../src/hooks/useProjectStream", () => ({ useProjectStream: () => ({ events: [] }) }));

import * as client from "../../../src/api/writer-client";
import { ArticleSection } from "../../../src/components/writer/ArticleSection";

const putSectionMock = client.putSection as unknown as ReturnType<typeof vi.fn>;
const uploadImageMock = client.uploadImage as unknown as ReturnType<typeof vi.fn>;

function dataTransferWith(files: File[]): any {
  return {
    files,
    items: files.map((f) => ({ kind: "file", type: f.type, getAsFile: () => f })),
    types: ["Files"],
  };
}

describe("SP-13 E2E: edit + image drop + save (T13)", () => {
  it("enters edit mode, drops image, saves with manual frontmatter", async () => {
    render(<ArticleSection projectId="p1" status="writing_ready" />);
    const toggle = await screen.findByTestId("edit-toggle-opening");
    fireEvent.click(toggle);
    const ta = (await screen.findByRole("textbox")) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "new body " } });
    // move caret to end
    ta.setSelectionRange(ta.value.length, ta.value.length);

    const file = new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" });
    const container = screen.getByTestId("section-editor-container");
    await act(async () => {
      fireEvent.drop(container, { dataTransfer: dataTransferWith([file]) });
      await Promise.resolve();
    });

    await waitFor(() => expect(uploadImageMock).toHaveBeenCalled());
    await waitFor(() => expect(ta.value).toContain("/api/projects/p1/images/abc.png"));

    await act(async () => {
      fireEvent.click(screen.getByText("保存"));
    });

    await waitFor(() => expect(putSectionMock).toHaveBeenCalled());
    const [pid, key, payload] = putSectionMock.mock.calls.at(-1)!;
    expect(pid).toBe("p1");
    expect(key).toBe("opening");
    expect(payload.body).toContain("![a.png](/api/projects/p1/images/abc.png)");
    expect(payload.frontmatter.manually_edited).toBe(true);
    expect(payload.frontmatter.edit_history).toHaveLength(1);
    // returns to render mode
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
  });
});

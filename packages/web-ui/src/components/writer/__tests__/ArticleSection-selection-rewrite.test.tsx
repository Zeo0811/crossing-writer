import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

function makeRect(): DOMRect {
  return { top: 100, left: 40, width: 80, height: 20, right: 120, bottom: 120, x: 40, y: 100, toJSON: () => ({}) } as DOMRect;
}

const mockSelectionState = {
  current: {
    range: null as Range | null,
    rect: null as DOMRect | null,
    text: "",
    isActive: false,
  },
};

vi.mock("../../../hooks/useTextSelection", () => ({
  useTextSelection: () => mockSelectionState.current,
}));

vi.mock("../../../hooks/useProjectStream", () => ({
  useProjectStream: () => ({ events: [] }),
}));

const getSectionsMock = vi.fn();
const getFinalMock = vi.fn();

vi.mock("../../../api/writer-client", async () => {
  const actual = await vi.importActual<any>("../../../api/writer-client");
  return {
    ...actual,
    getSections: (...args: any[]) => getSectionsMock(...args),
    getFinal: (...args: any[]) => getFinalMock(...args),
    rewriteSectionStream: vi.fn(),
    suggestRefs: vi.fn(async () => []),
    rewriteSelection: vi.fn(() => ({
      onEvent: (cb: (ev: { type: string }) => void) => {
        queueMicrotask(() => cb({ type: "writer.completed" }));
      },
      close: () => {},
    })),
  };
});

import { ArticleSection } from "../ArticleSection";

beforeEach(() => {
  vi.clearAllMocks();
  mockSelectionState.current = { range: null, rect: null, text: "", isActive: false };
  getSectionsMock.mockResolvedValue({
    sections: [
      {
        key: "opening",
        frontmatter: { section: "opening", last_agent: "w", last_updated_at: "t" },
        preview: "p",
      },
    ],
  });
  getFinalMock.mockResolvedValue("---\n---\n<!-- section:opening -->\n开头 选中的文字 结尾");
});

describe("ArticleSection selection → composer integration", () => {
  it("does not render bubble when selection inactive", async () => {
    render(<ArticleSection projectId="p1" status="writing_ready" />);
    await waitFor(() => expect(screen.getByText(/开头 选中的文字 结尾/)).toBeInTheDocument());
    expect(screen.queryByTestId("selection-bubble")).toBeNull();
  });

  it("renders SelectionBubble when selection is active", async () => {
    mockSelectionState.current = { range: null, rect: makeRect(), text: "选中的文字", isActive: true };
    render(<ArticleSection projectId="p1" status="writing_ready" />);
    await waitFor(() => expect(screen.getByTestId("selection-bubble")).toBeInTheDocument());
  });

  it("mounts InlineComposer when bubble is clicked, using snapshot of selected text", async () => {
    mockSelectionState.current = { range: null, rect: makeRect(), text: "选中的文字", isActive: true };
    render(<ArticleSection projectId="p1" status="writing_ready" />);
    const btn = await screen.findByRole("button", { name: /重写选中/ });
    fireEvent.click(btn);
    expect(screen.getByTestId("inline-composer")).toBeInTheDocument();
    expect(screen.getByTestId("composer-preview").textContent).toMatch(/选中的文字/);
  });

  it("onCompleted closes composer and triggers section refetch", async () => {
    mockSelectionState.current = { range: null, rect: makeRect(), text: "选中的文字", isActive: true };
    render(<ArticleSection projectId="p1" status="writing_ready" />);
    await waitFor(() => expect(getFinalMock).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole("button", { name: /重写选中/ }));
    const composer = screen.getByTestId("inline-composer");
    const ta = composer.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(ta, { target: { value: "prompt" } });
      fireEvent.keyDown(ta, { key: "Enter", metaKey: true });
    });
    await waitFor(() => expect(screen.queryByTestId("inline-composer")).toBeNull());
    await waitFor(() => expect(getFinalMock.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("no longer renders the SkillForm @skill button", async () => {
    render(<ArticleSection projectId="p1" status="writing_ready" />);
    await waitFor(() => expect(screen.getByText(/开头 选中的文字 结尾/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /@skill/ })).toBeNull();
  });
});

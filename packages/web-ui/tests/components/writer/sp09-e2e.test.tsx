import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ---- mocks ----

const { rewriteSelectionMock } = vi.hoisted(() => {
  const rewriteSelectionMock = vi.fn((_projectId: string, _sectionKey: string, payload: any) => {
    (globalThis as any).__lastRewritePayload = payload;
    const listeners: Array<(e: any) => void> = [];
    queueMicrotask(() => {
      for (const l of listeners) l({ type: "writer.started" });
      for (const l of listeners) l({ type: "writer.tool_called", data: { tool: "search_wiki" } });
      for (const l of listeners) l({ type: "writer.tool_returned", data: { tool: "search_wiki", ok: true } });
      for (const l of listeners) {
        l({
          type: "writer.selection_rewritten",
          data: {
            sectionKey: "opening",
            selected_text: payload.selected_text,
            new_text: "AI 内容工作室已经越来越多（新版）",
            ts: "2026-04-14T00:00:00Z",
          },
        });
      }
      for (const l of listeners) l({ type: "writer.completed" });
    });
    return {
      onEvent: (cb: any) => listeners.push(cb),
      close: () => {},
    };
  });
  return { rewriteSelectionMock };
});

vi.mock("../../../src/api/writer-client", async (orig) => {
  const actual = (await orig()) as any;
  return {
    ...actual,
    getSections: vi.fn(async () => ({
      sections: [
        {
          key: "opening",
          frontmatter: {
            section: "opening",
            last_agent: "writer.opening",
            last_updated_at: "2026-04-14T12:00:00Z",
          },
          preview: "p",
        },
      ],
    })),
    getFinal: vi.fn(async () =>
      "---\n---\n<!-- section:opening -->\nAI 内容工作室已经越来越多 and more tail text",
    ),
    rewriteSectionStream: vi.fn(),
    rewriteSelection: rewriteSelectionMock,
  };
});

vi.mock("../../../src/hooks/useProjectStream", () => ({
  useProjectStream: () => ({ events: [] }),
}));

// Force useTextSelection to return an active selection so SelectionBubble mounts.
const SELECTED_TEXT = "AI 内容工作室已经越来越多";
vi.mock("../../../src/hooks/useTextSelection", () => ({
  useTextSelection: () => ({
    range: null,
    rect: { top: 100, left: 100, width: 50, height: 20, bottom: 120, right: 150, x: 100, y: 100, toJSON: () => ({}) } as unknown as DOMRect,
    text: SELECTED_TEXT,
    isActive: true,
  }),
}));

import { ArticleSection } from "../../../src/components/writer/ArticleSection";

describe("SP-09 e2e: select → bubble → @ mention → submit", () => {
  beforeEach(() => {
    rewriteSelectionMock.mockClear();
    (globalThis as any).__lastRewritePayload = undefined;
  });

  it("completes the happy path end-to-end and closes composer", async () => {
    const user = userEvent.setup();
    render(<ArticleSection projectId="p1" status="writing_ready" />);

    // 1) SelectionBubble appears
    const bubble = await screen.findByTestId("selection-bubble");
    expect(bubble).toBeTruthy();

    // 2) Click bubble -> InlineComposer mounts
    fireEvent.click(screen.getByRole("button", { name: /重写选中/ }));
    const ta = (await screen.findByTestId("composer-textarea")) as HTMLTextAreaElement;
    expect(screen.getByTestId("composer-preview").textContent).toContain(SELECTED_TEXT);

    // 3) Type `@` -> static 2-item dropdown appears
    await user.click(ta);
    await user.type(ta, "用 @");
    await waitFor(() => expect(screen.getByTestId("mention-dropdown")).toBeTruthy());
    // exactly 2 rows
    expect(screen.getByTestId("mention-row-0")).toBeTruthy();
    expect(screen.getByTestId("mention-row-1")).toBeTruthy();
    expect(screen.queryByTestId("mention-row-2")).toBeNull();

    // 4) Enter picks first (search_wiki), inserts `@search_wiki `
    fireEvent.keyDown(ta, { key: "Enter" });
    await waitFor(() => expect(ta.value).toMatch(/@search_wiki /));

    // 5) Continue typing query + rest of prompt
    await user.type(ta, "AI.Talk 的资料把这段改得更有数据");

    // 6) Plain Enter submits (dropdown closed after skill insertion)
    await act(async () => {
      fireEvent.keyDown(ta, { key: "Enter" });
    });

    // 7) Composer closes after writer.completed
    await waitFor(() => expect(screen.queryByTestId("inline-composer")).toBeNull());

    // 8) Payload shape correctness: raw user_prompt contains `@search_wiki`; no references field
    const payload = (globalThis as any).__lastRewritePayload;
    expect(payload).toBeTruthy();
    expect(payload.selected_text).toBe(SELECTED_TEXT);
    expect(payload.user_prompt).toMatch(/@search_wiki AI\.Talk/);
    expect(payload.user_prompt).toMatch(/改得更有数据/);
    expect("references" in payload).toBe(false);
    expect(rewriteSelectionMock).toHaveBeenCalledTimes(1);
    expect(rewriteSelectionMock.mock.calls[0]?.[0]).toBe("p1");
    expect(rewriteSelectionMock.mock.calls[0]?.[1]).toBe("opening");
  });
});

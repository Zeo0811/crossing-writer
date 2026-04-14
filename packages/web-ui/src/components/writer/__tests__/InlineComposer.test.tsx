import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InlineComposer } from "../InlineComposer.js";

function makeRewrite(capture: { payload?: any }, opts?: { fail?: string }) {
  let cb: ((ev: { type: string; error?: string }) => void) | null = null;
  const stream = {
    onEvent: (fn: (ev: { type: string; error?: string }) => void) => { cb = fn; },
    close: vi.fn(),
  };
  const fn = vi.fn((_pid: string, _sk: string, payload: any) => {
    capture.payload = payload;
    queueMicrotask(() => cb?.({ type: "writer.started" }));
    queueMicrotask(() => {
      if (opts?.fail) cb?.({ type: "writer.failed", error: opts.fail });
      else cb?.({ type: "writer.completed" });
    });
    return stream;
  });
  return { fn, stream };
}

const noopStream = (() => ({ onEvent: () => {}, close: () => {} })) as any;

describe("InlineComposer", () => {
  it("triggers static mention dropdown on @ and inserts `@search_wiki ` on Enter", async () => {
    const user = userEvent.setup();
    const cap: { payload?: any } = {};
    const { fn: rewrite } = makeRewrite(cap);
    render(
      <InlineComposer
        projectId="p1" sectionKey="intro" selectedText="某段文字"
        onCancel={() => {}} onCompleted={() => {}}
        _rewrite={rewrite}
      />,
    );
    const ta = screen.getByTestId("composer-textarea") as HTMLTextAreaElement;
    await user.click(ta);
    await user.type(ta, "@");
    await waitFor(() => expect(screen.getByTestId("mention-dropdown")).toBeTruthy());
    // Two static rows only
    expect(screen.getByTestId("mention-row-0")).toBeTruthy();
    expect(screen.getByTestId("mention-row-1")).toBeTruthy();
    expect(screen.queryByTestId("mention-row-2")).toBeNull();
    fireEvent.keyDown(ta, { key: "Enter" });
    expect(ta.value).toBe("@search_wiki ");
  });

  it("ArrowDown then Enter picks the second item (search_raw)", async () => {
    const user = userEvent.setup();
    render(
      <InlineComposer
        projectId="p1" sectionKey="intro" selectedText="x"
        onCancel={() => {}} onCompleted={() => {}}
        _rewrite={noopStream}
      />,
    );
    const ta = screen.getByTestId("composer-textarea") as HTMLTextAreaElement;
    await user.click(ta);
    await user.type(ta, "@");
    await waitFor(() => expect(screen.getByTestId("mention-dropdown")).toBeTruthy());
    fireEvent.keyDown(ta, { key: "ArrowDown" });
    fireEvent.keyDown(ta, { key: "Enter" });
    expect(ta.value).toBe("@search_raw ");
  });

  it("submits on Cmd+Enter with raw user_prompt and no references field", async () => {
    const user = userEvent.setup();
    const cap: { payload?: any } = {};
    const { fn: rewrite } = makeRewrite(cap);
    const onCompleted = vi.fn();
    render(
      <InlineComposer
        projectId="p1" sectionKey="intro" selectedText="AI 内容工作室已经越来越多"
        onCancel={() => {}} onCompleted={onCompleted}
        _rewrite={rewrite}
      />,
    );
    const ta = screen.getByTestId("composer-textarea") as HTMLTextAreaElement;
    await user.click(ta);
    await user.type(ta, "用 @");
    await waitFor(() => expect(screen.getByTestId("mention-dropdown")).toBeTruthy());
    fireEvent.keyDown(ta, { key: "Enter" });
    await waitFor(() => expect(ta.value).toMatch(/@search_wiki /));
    await user.type(ta, "AI.Talk 的资料改写");
    await act(async () => {
      fireEvent.keyDown(ta, { key: "Enter", metaKey: true });
    });
    await waitFor(() => expect(onCompleted).toHaveBeenCalled());
    expect(rewrite).toHaveBeenCalled();
    expect(cap.payload.selected_text).toBe("AI 内容工作室已经越来越多");
    expect(cap.payload.user_prompt).toMatch(/@search_wiki AI\.Talk 的资料改写/);
    expect(cap.payload.references).toBeUndefined();
  });

  it("Esc (outside mention mode) calls onCancel", () => {
    const onCancel = vi.fn();
    render(
      <InlineComposer
        projectId="p1" sectionKey="intro" selectedText="x"
        onCancel={onCancel} onCompleted={() => {}}
        _rewrite={noopStream}
      />,
    );
    const ta = screen.getByTestId("composer-textarea");
    fireEvent.keyDown(ta, { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });

  it("Esc inside mention mode closes dropdown and does not call onCancel", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <InlineComposer
        projectId="p1" sectionKey="intro" selectedText="x"
        onCancel={onCancel} onCompleted={() => {}}
        _rewrite={noopStream}
      />,
    );
    const ta = screen.getByTestId("composer-textarea") as HTMLTextAreaElement;
    await user.click(ta);
    await user.type(ta, "@");
    await waitFor(() => expect(screen.getByTestId("mention-dropdown")).toBeTruthy());
    fireEvent.keyDown(ta, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("mention-dropdown")).toBeNull());
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("typing whitespace after @ closes dropdown (no pill lookup mode)", async () => {
    const user = userEvent.setup();
    render(
      <InlineComposer
        projectId="p1" sectionKey="intro" selectedText="x"
        onCancel={() => {}} onCompleted={() => {}}
        _rewrite={noopStream}
      />,
    );
    const ta = screen.getByTestId("composer-textarea") as HTMLTextAreaElement;
    await user.click(ta);
    await user.type(ta, "@");
    await waitFor(() => expect(screen.getByTestId("mention-dropdown")).toBeTruthy());
    await user.type(ta, " hi");
    await waitFor(() => expect(screen.queryByTestId("mention-dropdown")).toBeNull());
  });

  it("truncates selected-text preview over 60 chars", () => {
    const long = "あ".repeat(80);
    render(
      <InlineComposer
        projectId="p" sectionKey="s" selectedText={long}
        onCancel={() => {}} onCompleted={() => {}}
        _rewrite={noopStream}
      />,
    );
    expect(screen.getByTestId("composer-preview").textContent).toMatch(/…$/);
  });

  it("shows error message when stream emits writer.failed", async () => {
    const user = userEvent.setup();
    const cap: { payload?: any } = {};
    const { fn: rewrite } = makeRewrite(cap, { fail: "boom" });
    render(
      <InlineComposer
        projectId="p1" sectionKey="intro" selectedText="x"
        onCancel={() => {}} onCompleted={() => {}}
        _rewrite={rewrite}
      />,
    );
    const ta = screen.getByTestId("composer-textarea") as HTMLTextAreaElement;
    await user.click(ta);
    await user.type(ta, "hi");
    await act(async () => {
      fireEvent.keyDown(ta, { key: "Enter", metaKey: true });
    });
    await waitFor(() => expect(screen.getByTestId("composer-error").textContent).toMatch(/boom/));
  });
});

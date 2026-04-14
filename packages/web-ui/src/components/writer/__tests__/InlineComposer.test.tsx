import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InlineComposer } from "../InlineComposer.js";
import type { SuggestItem } from "../../../api/writer-client.js";

const sample: SuggestItem[] = [
  { kind: "wiki", id: "entities/AI.Talk.md", title: "AI.Talk", excerpt: "AI studio" },
  { kind: "raw", id: "abc", title: "Top100", account: "花叔", published_at: "2024-08-28", excerpt: "..." },
];

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
  it("triggers mention dropdown on @ and inserts wiki pill on Enter", async () => {
    const user = userEvent.setup();
    const suggest = vi.fn(async () => sample);
    const cap: { payload?: any } = {};
    const { fn: rewrite } = makeRewrite(cap);
    render(
      <InlineComposer
        projectId="p1" sectionKey="intro" selectedText="某段文字"
        onCancel={() => {}} onCompleted={() => {}}
        _suggest={suggest} _rewrite={rewrite}
      />,
    );
    const ta = screen.getByTestId("composer-textarea") as HTMLTextAreaElement;
    await user.click(ta);
    await user.type(ta, "@AI");
    await waitFor(() => expect(suggest).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId("mention-dropdown")).toBeTruthy());
    fireEvent.keyDown(ta, { key: "Enter" });
    expect(ta.value).toMatch(/\[wiki:AI\.Talk\]/);
  });

  it("ArrowDown then Enter picks the second item (raw)", async () => {
    const user = userEvent.setup();
    const suggest = vi.fn(async () => sample);
    const cap: { payload?: any } = {};
    const { fn: rewrite } = makeRewrite(cap);
    render(
      <InlineComposer
        projectId="p1" sectionKey="intro" selectedText="x"
        onCancel={() => {}} onCompleted={() => {}}
        _suggest={suggest} _rewrite={rewrite}
      />,
    );
    const ta = screen.getByTestId("composer-textarea") as HTMLTextAreaElement;
    await user.click(ta);
    await user.type(ta, "@To");
    await waitFor(() => expect(screen.getByTestId("mention-dropdown")).toBeTruthy());
    fireEvent.keyDown(ta, { key: "ArrowDown" });
    fireEvent.keyDown(ta, { key: "Enter" });
    expect(ta.value).toMatch(/\[raw:Top100\]/);
  });

  it("submits on Cmd+Enter with references payload and calls onCompleted", async () => {
    const user = userEvent.setup();
    const suggest = vi.fn(async () => sample);
    const cap: { payload?: any } = {};
    const { fn: rewrite } = makeRewrite(cap);
    const onCompleted = vi.fn();
    render(
      <InlineComposer
        projectId="p1" sectionKey="intro" selectedText="AI 内容工作室已经越来越多"
        onCancel={() => {}} onCompleted={onCompleted}
        _suggest={suggest} _rewrite={rewrite}
      />,
    );
    const ta = screen.getByTestId("composer-textarea") as HTMLTextAreaElement;
    await user.click(ta);
    await user.type(ta, "@AI");
    await waitFor(() => expect(screen.getByTestId("mention-dropdown")).toBeTruthy());
    fireEvent.keyDown(ta, { key: "Enter" });
    await user.type(ta, " 改得更有数据");
    await act(async () => {
      fireEvent.keyDown(ta, { key: "Enter", metaKey: true });
    });
    await waitFor(() => expect(onCompleted).toHaveBeenCalled());
    expect(rewrite).toHaveBeenCalled();
    expect(cap.payload.selected_text).toBe("AI 内容工作室已经越来越多");
    expect(cap.payload.references[0]).toMatchObject({
      kind: "wiki", id: "entities/AI.Talk.md", title: "AI.Talk", excerpt: "AI studio",
    });
    expect(cap.payload.user_prompt).toMatch(/改得更有数据/);
  });

  it("Esc (outside mention mode) calls onCancel", () => {
    const onCancel = vi.fn();
    render(
      <InlineComposer
        projectId="p1" sectionKey="intro" selectedText="x"
        onCancel={onCancel} onCompleted={() => {}}
        _suggest={async () => []} _rewrite={noopStream}
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
        _suggest={async () => sample} _rewrite={noopStream}
      />,
    );
    const ta = screen.getByTestId("composer-textarea") as HTMLTextAreaElement;
    await user.click(ta);
    await user.type(ta, "@AI");
    await waitFor(() => expect(screen.getByTestId("mention-dropdown")).toBeTruthy());
    fireEvent.keyDown(ta, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("mention-dropdown")).toBeNull());
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("Backspace right after ] deletes the whole pill token", async () => {
    const user = userEvent.setup();
    const suggest = vi.fn(async () => sample);
    render(
      <InlineComposer
        projectId="p1" sectionKey="intro" selectedText="x"
        onCancel={() => {}} onCompleted={() => {}}
        _suggest={suggest} _rewrite={noopStream}
      />,
    );
    const ta = screen.getByTestId("composer-textarea") as HTMLTextAreaElement;
    await user.click(ta);
    await user.type(ta, "@AI");
    await waitFor(() => expect(screen.getByTestId("mention-dropdown")).toBeTruthy());
    fireEvent.keyDown(ta, { key: "Enter" });
    await waitFor(() => expect(ta.value).toMatch(/\[wiki:AI\.Talk\]/));
    // caret should be right after ]
    fireEvent.keyDown(ta, { key: "Backspace" });
    await waitFor(() => expect(ta.value).not.toMatch(/\[wiki:AI\.Talk\]/));
    expect(ta.value).toBe("");
  });

  it("truncates selected-text preview over 60 chars", () => {
    const long = "あ".repeat(80);
    render(
      <InlineComposer
        projectId="p" sectionKey="s" selectedText={long}
        onCancel={() => {}} onCompleted={() => {}}
        _suggest={async () => []} _rewrite={noopStream}
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
        _suggest={async () => []} _rewrite={rewrite}
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

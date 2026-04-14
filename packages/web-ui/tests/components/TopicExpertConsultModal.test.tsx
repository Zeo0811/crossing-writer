import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { TopicExpertConsultModal } from "../../src/components/project/TopicExpertConsultModal";

const seededExperts = [
  { name: "A", specialty: "zen", active: true, default_preselect: true, soft_deleted: false },
  { name: "B", specialty: "hard", active: true, default_preselect: true, soft_deleted: false },
  { name: "C", specialty: "cool", active: true, default_preselect: false, soft_deleted: false },
  { name: "D", specialty: "off", active: false, default_preselect: false, soft_deleted: false },
];

function mkApi(script?: (names: string[], h: any) => void) {
  const list = vi.fn(async () => ({ experts: [...seededExperts] }));
  let lastHandlers: any = null;
  const consult = vi.fn((_pid: string, body: any, h: any) => {
    lastHandlers = h;
    if (script) script(body.selected, h);
    else {
      h.onEvent("topic_consult.started", { invokeType: body.invokeType, selected: body.selected });
      for (const n of body.selected) {
        h.onEvent("expert_started", { name: n });
        h.onEvent("expert_done", { name: n, markdown: `md-${n}`, meta: { cli: "claude", durationMs: 1 } });
      }
      h.onEvent("all_done", { succeeded: body.selected, failed: [] });
    }
    return { abort: () => {} };
  });
  return { api: { list, consult }, get lastHandlers() { return lastHandlers; } };
}

describe("TopicExpertConsultModal", () => {
  it("defaults preselects experts with default_preselect:true", async () => {
    const { api } = mkApi();
    render(<TopicExpertConsultModal projectId="p1" open onClose={() => {}} api={api} />);
    await waitFor(() => screen.getByLabelText("select-A"));
    expect((screen.getByLabelText("select-A") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("select-B") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("select-C") as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByLabelText("select-D")).toBeNull();
  });

  it("invokeType score is default", async () => {
    const { api } = mkApi();
    render(<TopicExpertConsultModal projectId="p1" open onClose={() => {}} api={api} />);
    await waitFor(() => screen.getByLabelText("invokeType-score"));
    expect((screen.getByLabelText("invokeType-score") as HTMLInputElement).checked).toBe(true);
  });

  it("submit triggers SSE with correct payload", async () => {
    const { api } = mkApi();
    render(<TopicExpertConsultModal projectId="p1" briefSummary="BS" open onClose={() => {}} api={api} />);
    await waitFor(() => screen.getByTestId("consult-start"));
    fireEvent.click(screen.getByTestId("consult-start"));
    expect(api.consult).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ selected: ["A", "B"], invokeType: "score", brief: "BS" }),
      expect.any(Object),
    );
  });

  it("expert_done renders markdown in card", async () => {
    const { api } = mkApi();
    render(<TopicExpertConsultModal projectId="p1" open onClose={() => {}} api={api} />);
    await waitFor(() => screen.getByTestId("consult-start"));
    fireEvent.click(screen.getByTestId("consult-start"));
    await waitFor(() => screen.getByTestId("expert-md-A"));
    expect(screen.getByTestId("expert-md-A").textContent).toContain("md-A");
    expect(screen.getByTestId("consult-progress").textContent).toContain("2 / 2");
  });

  it("expert_delta appends to card markdown progressively", async () => {
    const script = (names: string[], h: any) => {
      h.onEvent("topic_consult.started", { invokeType: "score", selected: names });
      h.onEvent("expert_started", { name: "A" });
      h.onEvent("expert_delta", { name: "A", chunk: "He" });
      h.onEvent("expert_delta", { name: "A", chunk: "llo" });
      h.onEvent("expert_done", { name: "A", markdown: "Hello" });
      h.onEvent("all_done", { succeeded: ["A"], failed: [] });
    };
    const api = {
      list: vi.fn(async () => ({ experts: [seededExperts[0]!] })),
      consult: vi.fn((_p: string, body: any, h: any) => { script(body.selected, h); return { abort: () => {} }; }),
    };
    render(<TopicExpertConsultModal projectId="p1" open onClose={() => {}} api={api as any} />);
    await waitFor(() => screen.getByTestId("consult-start"));
    fireEvent.click(screen.getByTestId("consult-start"));
    await waitFor(() => screen.getByTestId("expert-md-A"));
    expect(screen.getByTestId("expert-md-A").textContent).toContain("Hello");
  });

  it("expert_failed shows retry; clicking retry re-opens SSE", async () => {
    let attempt = 0;
    const script = (names: string[], h: any) => {
      attempt++;
      h.onEvent("topic_consult.started", { invokeType: "score", selected: names });
      if (attempt === 1) {
        h.onEvent("expert_failed", { name: "A", error: "boom" });
        h.onEvent("all_done", { succeeded: [], failed: ["A"] });
      } else {
        h.onEvent("expert_done", { name: "A", markdown: "md-retry" });
        h.onEvent("all_done", { succeeded: ["A"], failed: [] });
      }
    };
    const api = {
      list: vi.fn(async () => ({ experts: [seededExperts[0]!] })),
      consult: vi.fn((_p: string, body: any, h: any) => { script(body.selected, h); return { abort: () => {} }; }),
    };
    render(<TopicExpertConsultModal projectId="p1" open onClose={() => {}} api={api as any} />);
    await waitFor(() => screen.getByTestId("consult-start"));
    fireEvent.click(screen.getByTestId("consult-start"));
    await waitFor(() => screen.getByTestId("expert-retry-A"));
    fireEvent.click(screen.getByTestId("expert-retry-A"));
    expect(api.consult).toHaveBeenCalledTimes(2);
  });

  it("保存到项目笔记 emits combined markdown via onSaved", async () => {
    const { api } = mkApi();
    const onSaved = vi.fn();
    render(
      <TopicExpertConsultModal
        projectId="p1"
        open
        onClose={() => {}}
        onSaved={onSaved}
        api={api}
      />,
    );
    await waitFor(() => screen.getByTestId("consult-start"));
    fireEvent.click(screen.getByTestId("consult-start"));
    await waitFor(() => screen.getByTestId("consult-save"));
    fireEvent.click(screen.getByTestId("consult-save"));
    expect(onSaved).toHaveBeenCalledWith(expect.stringContaining("## A"));
    expect(onSaved.mock.calls[0]![0]).toContain("md-A");
  });
});

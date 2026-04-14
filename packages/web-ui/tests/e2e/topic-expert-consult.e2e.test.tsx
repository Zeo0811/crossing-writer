import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TopicExpertSummonButton } from "../../src/components/project/TopicExpertSummonButton";

function sseBody(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const chunk of chunks) c.enqueue(enc.encode(chunk));
      c.close();
    },
  });
}

describe("E2E: topic-expert consult via mocked backend", () => {
  beforeEach(() => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith("/api/topic-experts") && (!init || init.method === undefined || init.method === "GET")) {
        return {
          ok: true, status: 200, text: async () => "",
          json: async () => ({
            experts: [
              { name: "A", specialty: "zen", active: true, default_preselect: true, soft_deleted: false },
              { name: "B", specialty: "hard", active: true, default_preselect: true, soft_deleted: false },
              { name: "C", specialty: "cool", active: true, default_preselect: false, soft_deleted: false },
            ],
          }),
        } as any;
      }
      if (url.includes("/topic-experts/consult")) {
        const body = JSON.parse(init!.body as string);
        const chunks: string[] = [];
        chunks.push(`event: topic_consult.started\ndata: ${JSON.stringify({ invokeType: body.invokeType, selected: body.selected })}\n\n`);
        for (const n of body.selected) {
          chunks.push(`event: expert_started\ndata: {"name":"${n}"}\n\n`);
          chunks.push(`event: expert_delta\ndata: {"name":"${n}","chunk":"part1-"}\n\n`);
          chunks.push(`event: expert_delta\ndata: {"name":"${n}","chunk":"part2"}\n\n`);
          if (body.failB && n === "B") {
            chunks.push(`event: expert_failed\ndata: {"name":"${n}","error":"boom"}\n\n`);
          } else {
            chunks.push(`event: expert_done\ndata: {"name":"${n}","markdown":"final-${n}"}\n\n`);
          }
        }
        const succ = body.failB ? body.selected.filter((x: string) => x !== "B") : body.selected;
        const fail = body.failB ? ["B"] : [];
        chunks.push(`event: all_done\ndata: ${JSON.stringify({ succeeded: succ, failed: fail })}\n\n`);
        return { ok: true, status: 200, body: sseBody(chunks) } as any;
      }
      return { ok: false, status: 404, text: async () => "" } as any;
    });
    globalThis.fetch = fetchMock as any;
  });

  it("happy path: defaults preselect A+B, stream completes with 2/2 and save emits combined markdown", async () => {
    const saved = vi.fn();
    render(
      <TopicExpertSummonButton
        projectId="p1"
        briefSummary="BS"
        onSaveNote={saved}
      />,
    );

    fireEvent.click(screen.getByTestId("topic-expert-summon-btn"));
    await waitFor(() => screen.getByLabelText("select-A"));
    expect((screen.getByLabelText("select-A") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("select-B") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("select-C") as HTMLInputElement).checked).toBe(false);

    fireEvent.click(screen.getByTestId("consult-start"));
    await waitFor(() => screen.getByTestId("expert-md-A"), { timeout: 2000 });
    await waitFor(() => screen.getByTestId("consult-save"), { timeout: 2000 });

    expect(screen.getByTestId("expert-md-A").textContent).toContain("final-A");
    expect(screen.getByTestId("expert-md-B").textContent).toContain("final-B");
    expect(screen.getByTestId("consult-progress").textContent).toContain("2 / 2");

    fireEvent.click(screen.getByTestId("consult-save"));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(saved.mock.calls[0]![0]).toBe("topic-expert-panel.md");
    expect(saved.mock.calls[0]![1]).toContain("## A");
    expect(saved.mock.calls[0]![1]).toContain("final-A");
  });
});

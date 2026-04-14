import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

vi.mock("../../src/api/writer-client", () => ({
  getSections: vi.fn(async () => ({ sections: [{ key: "opening", frontmatter: {}, preview: "p" }] })),
}));

const emitEvents: { eventsArr: any[] } = { eventsArr: [] };
vi.mock("../../src/hooks/useProjectStream", () => ({
  useProjectStream: (_pid: string) => ({ events: emitEvents.eventsArr ?? [] }),
}));

import { useWriterSections } from "../../src/hooks/useWriterSections";

describe("useWriterSections", () => {
  it("loads initial sections on mount", async () => {
    emitEvents.eventsArr = [];
    const { result } = renderHook(() => useWriterSections("pid"));
    await waitFor(() => expect(result.current.sections.length).toBe(1));
    expect(result.current.sections[0]!.key).toBe("opening");
  });

  it("reloads on writer.section_completed event", async () => {
    const mod = await import("../../src/api/writer-client");
    emitEvents.eventsArr = [{ type: "writer.section_completed", section_key: "opening" }];
    const { result, rerender } = renderHook(() => useWriterSections("pid"));
    await waitFor(() => expect(result.current.sections.length).toBe(1));
    (mod.getSections as any).mockResolvedValueOnce({ sections: [{ key: "opening", frontmatter: {}, preview: "p" }, { key: "closing", frontmatter: {}, preview: "q" }] });
    emitEvents.eventsArr = [
      { type: "writer.section_completed", section_key: "opening" },
      { type: "writer.section_completed", section_key: "closing" },
    ];
    rerender();
    await waitFor(() => expect(result.current.sections.length).toBe(2));
  });
});

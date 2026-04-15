import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTopicExpertConsult } from "../src/services/topic-expert-consult.js";

describe("runTopicExpertConsult — forwards project images + addDirs", () => {
  it("passes collected brief images to invokeTopicExpert for each expert", async () => {
    const projectsDir = mkdtempSync(join(tmpdir(), "tec-img-"));
    const projectId = "proj-1";
    const pDir = join(projectsDir, projectId);
    mkdirSync(join(pDir, "brief/images"), { recursive: true });
    writeFileSync(join(pDir, "brief/images/a.png"), "x");

    const invoke = vi.fn(async () => ({
      markdown: "# out",
      meta: { cli: "claude", model: null, durationMs: 1 },
    }));
    const store = {
      get: async (name: string) => ({ name, kb_markdown: `kb-${name}` }),
    } as any;

    const emit = vi.fn();
    await runTopicExpertConsult(
      {
        projectId,
        selectedExperts: ["A", "B"],
        invokeType: "score",
        brief: "b",
        productContext: "c",
      },
      {
        store,
        invoke,
        emit,
        projectsDir,
      },
    );

    expect(invoke).toHaveBeenCalledTimes(2);
    for (const call of invoke.mock.calls) {
      const args = call[0];
      expect(args.images).toEqual(expect.arrayContaining([join(pDir, "brief/images/a.png")]));
      expect(args.addDirs).toEqual([pDir]);
    }
  });
});

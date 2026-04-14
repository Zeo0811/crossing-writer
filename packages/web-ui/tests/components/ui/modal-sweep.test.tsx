import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MODAL_FILES = [
  "src/components/config/DistillModal.tsx",
  "src/components/config/ProjectOverridePanel.tsx",
  "src/components/config/NewTopicExpertModal.tsx",
  "src/components/project/TopicExpertConsultModal.tsx",
  "src/components/settings/SettingsDrawer.tsx",
];

describe("modal sweep T20", () => {
  it.each(MODAL_FILES)("%s declares data-modal-root and uses token-based shell", (rel) => {
    const p = resolve(__dirname, "../../..", rel);
    const src = readFileSync(p, "utf8");
    expect(src).toMatch(/data-modal-root/);
    expect(src).not.toMatch(/bg-white\b/);
  });
});

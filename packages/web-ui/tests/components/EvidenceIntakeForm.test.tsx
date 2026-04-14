import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { EvidenceIntakeForm } from "../../src/components/evidence/EvidenceIntakeForm";
import { ToastProvider } from "../../src/components/ui/ToastProvider";

vi.mock("../../src/api/evidence-client", () => ({
  getCaseEvidence: vi.fn(async (_p, _c) => ({
    case_id: "case-01",
    name: "Alpha",
    screenshots: [],
    recordings: [],
    generated: [],
    notes: null,
    completeness: { complete: false, missing: ["screenshot", "notes", "generated"], has_screenshot: false, has_notes: false, has_generated: false },
  })),
  uploadEvidenceFile: vi.fn(async () => ({})),
  deleteEvidenceFile: vi.fn(async () => {}),
  putNotes: vi.fn(async () => {}),
}));

vi.mock("../../src/hooks/useProjectStream", () => ({
  useProjectStream: () => ({ events: [], activeAgents: [] }),
}));

function wrap(ui: React.ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

describe("EvidenceIntakeForm", () => {
  it("renders 3 uploaders + notes editor for selected case", async () => {
    wrap(<EvidenceIntakeForm projectId="p1" caseId="case-01" />);
    await waitFor(() => screen.getByText(/Alpha/));
    expect(screen.getByText(/过程截图/)).toBeInTheDocument();
    expect(screen.getByText(/录屏/)).toBeInTheDocument();
    expect(screen.getByText(/产品产出/)).toBeInTheDocument();
    expect(screen.getByText(/观察笔记/)).toBeInTheDocument();
  });
});

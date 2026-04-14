import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { IngestProgressView } from "../src/components/wiki/IngestProgressView";
import type { IngestStreamEvent } from "../src/api/wiki-client";

describe("IngestProgressView", () => {
  it("renders events as log lines with terminal styling", () => {
    const events: IngestStreamEvent[] = [
      { type: "batch_started", account: "acc1", batchIndex: 0, totalBatches: 1 },
      { type: "op_applied", op: "upsert", path: "entities/A.md" },
      { type: "all_completed", stats: { pages_created: 1 } },
    ];
    render(<IngestProgressView events={events} status="done" error={null} />);
    expect(screen.getByText(/BATCH/i)).toBeInTheDocument();
    expect(screen.getByText(/entities\/A\.md/)).toBeInTheDocument();
    expect(screen.getByText(/DONE/i)).toBeInTheDocument();
  });

  it("shows error banner when error", () => {
    render(<IngestProgressView events={[]} status="error" error="boom" />);
    expect(screen.getByText(/boom/)).toBeInTheDocument();
  });
});

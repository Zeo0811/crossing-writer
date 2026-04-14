import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AccountCandidateList } from "../../../src/components/style-panels/AccountCandidateList.js";

describe("AccountCandidateList", () => {
  it("filters out already-distilled accounts and shows candidates", () => {
    render(
      <AccountCandidateList
        accounts={[
          { account: "量子位", count: 1982, earliest_published_at: "2024-09-01", latest_published_at: "2026-04-01" },
          { account: "赛博禅心", count: 1229, earliest_published_at: "2023-11-01", latest_published_at: "2026-04-01" },
        ]}
        distilledIds={new Set(["赛博禅心"])}
        onDistill={() => {}}
      />,
    );
    expect(screen.getByText("量子位")).toBeInTheDocument();
    expect(screen.queryByText("赛博禅心")).not.toBeInTheDocument();
  });

  it("calls onDistill(account) when 蒸馏 button clicked", () => {
    const cb = vi.fn();
    render(
      <AccountCandidateList
        accounts={[{ account: "量子位", count: 10, earliest_published_at: "2024-09-01", latest_published_at: "2026-04-01" }]}
        distilledIds={new Set()}
        onDistill={cb}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /蒸馏/ }));
    expect(cb).toHaveBeenCalledWith("量子位");
  });
});

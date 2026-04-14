import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StylePanelList } from "../../../src/components/style-panels/StylePanelList.js";

describe("StylePanelList", () => {
  it("renders distilled panels with id + last_updated_at + redistill button", () => {
    render(
      <StylePanelList
        panels={[
          { id: "十字路口Crossing", path: "/x.md", last_updated_at: "2026-04-10T00:00:00Z" },
          { id: "赛博禅心", path: "/y.md", last_updated_at: "2026-04-13T00:00:00Z" },
        ]}
        onRedistill={() => {}}
      />,
    );
    expect(screen.getByText("十字路口Crossing")).toBeInTheDocument();
    expect(screen.getByText("赛博禅心")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /重新蒸馏/ })).toHaveLength(2);
  });

  it("shows empty state when no panels", () => {
    render(<StylePanelList panels={[]} onRedistill={() => {}} />);
    expect(screen.getByText(/尚未蒸馏/)).toBeInTheDocument();
  });
});

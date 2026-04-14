import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { SelectionBubble } from "../../../src/components/writer/SelectionBubble";

describe("SelectionBubble restyle", () => {
  it("bubble button uses bg-bg-2 + hair-strong border", () => {
    const { getByRole } = render(
      <SelectionBubble rect={new DOMRect(10, 10, 10, 10)} onClick={() => {}} />
    );
    const btn = getByRole("button");
    expect(btn.className).toMatch(/bg-bg-2/);
    expect(btn.className).toMatch(/border-hair-strong/);
  });
});

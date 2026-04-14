import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { IngestForm } from "../src/components/wiki/IngestForm";

describe("IngestForm", () => {
  it("submits selected accounts + opts", () => {
    const onSubmit = vi.fn();
    render(<IngestForm accounts={["acc1", "acc2"]} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByLabelText("acc1"));
    fireEvent.click(screen.getByLabelText("acc2"));
    fireEvent.change(screen.getByLabelText(/per account/i), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText(/batch size/i), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: /start/i }));
    expect(onSubmit).toHaveBeenCalledWith({
      accounts: ["acc1", "acc2"],
      per_account_limit: 20,
      batch_size: 3,
      mode: "full",
      cli_model: { cli: "claude", model: "opus" },
    });
  });

  it("disables submit when no accounts selected", () => {
    render(<IngestForm accounts={["acc1"]} onSubmit={() => {}} />);
    expect(screen.getByRole("button", { name: /start/i })).toBeDisabled();
  });
});

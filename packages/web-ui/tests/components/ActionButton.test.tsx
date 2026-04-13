import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ActionButton } from "../../src/components/ui/ActionButton";
import { ToastProvider } from "../../src/components/ui/ToastProvider";

function wrap(ui: React.ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

describe("ActionButton", () => {
  it("disables + shows spinner while onClick pending", async () => {
    let resolve!: () => void;
    const onClick = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
    wrap(<ActionButton onClick={onClick}>Save</ActionButton>);
    const btn = screen.getByRole("button", { name: /Save/ });
    fireEvent.click(btn);
    expect(btn).toBeDisabled();
    expect(screen.getByTestId("action-spinner")).toBeInTheDocument();
    resolve!();
    await waitFor(() => expect(btn).not.toBeDisabled());
  });

  it("ignores double click while pending", async () => {
    let resolve!: () => void;
    const onClick = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
    wrap(<ActionButton onClick={onClick}>Save</ActionButton>);
    const btn = screen.getByRole("button", { name: /Save/ });
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
    resolve!();
    await waitFor(() => expect(btn).not.toBeDisabled());
  });

  it("shows success toast on resolve", async () => {
    const onClick = vi.fn(() => Promise.resolve());
    wrap(<ActionButton onClick={onClick} successMsg="Saved!">Save</ActionButton>);
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    await waitFor(() => expect(screen.getByText("Saved!")).toBeInTheDocument());
  });

  it("shows error toast + inline echo on reject", async () => {
    const onClick = vi.fn(() => Promise.reject(new Error("Network fail")));
    wrap(
      <ActionButton
        onClick={onClick}
        errorMsg={(e) => `Oops: ${(e as Error).message}`}
      >
        Save
      </ActionButton>
    );
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    await waitFor(() => {
      expect(screen.getAllByText("Oops: Network fail")).toHaveLength(2);
      expect(screen.getByTestId("action-error-echo")).toBeInTheDocument();
      expect(screen.getByTestId("toast-error")).toBeInTheDocument();
    });
  });

  it("respects external disabled prop", () => {
    wrap(<ActionButton onClick={() => Promise.resolve()} disabled>Save</ActionButton>);
    expect(screen.getByRole("button", { name: /Save/ })).toBeDisabled();
  });

  it("applies variant classes", () => {
    wrap(<ActionButton onClick={() => Promise.resolve()} variant="danger">Delete</ActionButton>);
    expect(screen.getByRole("button", { name: /Delete/ }).className).toMatch(/red/);
  });
});

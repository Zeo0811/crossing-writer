import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Modal } from "../../../src/components/ui/Modal";

describe("Modal", () => {
  it("does not render when open=false", () => {
    render(
      <Modal open={false} onClose={() => {}} title="t">
        body
      </Modal>
    );
    expect(screen.queryByText("body")).toBeNull();
  });

  it("renders title and body when open", () => {
    render(
      <Modal open onClose={() => {}} title="Settings">
        hello
      </Modal>
    );
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("clicking overlay fires onClose", () => {
    const fn = vi.fn();
    render(
      <Modal open onClose={fn} title="t">
        x
      </Modal>
    );
    fireEvent.click(screen.getByTestId("modal-overlay"));
    expect(fn).toHaveBeenCalledOnce();
  });

  it("Escape key fires onClose", () => {
    const fn = vi.fn();
    render(
      <Modal open onClose={fn} title="t">
        x
      </Modal>
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(fn).toHaveBeenCalledOnce();
  });
});

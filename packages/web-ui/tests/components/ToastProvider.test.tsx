import { describe, it, expect, vi } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { ToastProvider, useToast } from "../../src/components/ui/ToastProvider";

function Consumer({ label, onReady }: { label: string; onReady: (api: ReturnType<typeof useToast>) => void }) {
  const t = useToast();
  onReady(t);
  return <span>{label}</span>;
}

describe("ToastProvider + useToast", () => {
  it("renders children and exposes hook", () => {
    const api: any = {};
    render(
      <ToastProvider>
        <Consumer label="child" onReady={(t) => { Object.assign(api, t); }} />
      </ToastProvider>
    );
    expect(screen.getByText("child")).toBeInTheDocument();
    expect(typeof api.success).toBe("function");
    expect(typeof api.error).toBe("function");
    expect(typeof api.info).toBe("function");
  });

  it("pushes success toast and auto-dismisses after 5s", () => {
    vi.useFakeTimers();
    const api: any = {};
    render(
      <ToastProvider>
        <Consumer label="x" onReady={(t) => Object.assign(api, t)} />
      </ToastProvider>
    );
    act(() => { api.success("saved"); });
    expect(screen.getByText("saved")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(5001); });
    expect(screen.queryByText("saved")).toBeNull();
    vi.useRealTimers();
  });

  it("caps at 3 toasts, oldest dropped", () => {
    const api: any = {};
    render(
      <ToastProvider>
        <Consumer label="x" onReady={(t) => Object.assign(api, t)} />
      </ToastProvider>
    );
    act(() => {
      api.info("a"); api.info("b"); api.info("c"); api.info("d");
    });
    expect(screen.queryByText("a")).toBeNull();
    expect(screen.getByText("b")).toBeInTheDocument();
    expect(screen.getByText("c")).toBeInTheDocument();
    expect(screen.getByText("d")).toBeInTheDocument();
  });

  it("different types have different data-testid", () => {
    const api: any = {};
    render(
      <ToastProvider>
        <Consumer label="x" onReady={(t) => Object.assign(api, t)} />
      </ToastProvider>
    );
    act(() => {
      api.success("s"); api.error("e"); api.info("i");
    });
    expect(screen.getByTestId("toast-success")).toBeInTheDocument();
    expect(screen.getByTestId("toast-error")).toBeInTheDocument();
    expect(screen.getByTestId("toast-info")).toBeInTheDocument();
  });

  it("throws helpful error when useToast used outside provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    function Lone() {
      useToast();
      return null;
    }
    expect(() => render(<Lone />)).toThrow(/ToastProvider/);
    spy.mockRestore();
  });
});

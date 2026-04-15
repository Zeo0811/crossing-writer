import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { ArchivedProjectList } from "../../src/components/project/ArchivedProjectList";

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ArchivedProjectList", () => {
  const sample = [
    { id: "a1", name: "First", slug: "first", status: "created", stage: "intake", updated_at: new Date().toISOString() } as any,
  ];

  it("renders archived cards with 恢复 and 硬删 buttons", () => {
    wrap(<ArchivedProjectList items={sample} onRestore={() => {}} onDelete={() => {}} />);
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("恢复")).toBeInTheDocument();
    expect(screen.getByText("硬删")).toBeInTheDocument();
  });

  it("calls onRestore(id) when 恢复 clicked", () => {
    const onRestore = vi.fn();
    wrap(<ArchivedProjectList items={sample} onRestore={onRestore} onDelete={() => {}} />);
    fireEvent.click(screen.getByText("恢复"));
    expect(onRestore).toHaveBeenCalledWith("a1");
  });

  it("calls onDelete(project) when 硬删 clicked", () => {
    const onDelete = vi.fn();
    wrap(<ArchivedProjectList items={sample} onRestore={() => {}} onDelete={onDelete} />);
    fireEvent.click(screen.getByText("硬删"));
    expect(onDelete).toHaveBeenCalledWith(sample[0]);
  });

  it("renders empty state when no items", () => {
    wrap(<ArchivedProjectList items={[]} onRestore={() => {}} onDelete={() => {}} />);
    expect(screen.getByText(/暂无已归档项目/)).toBeInTheDocument();
  });
});

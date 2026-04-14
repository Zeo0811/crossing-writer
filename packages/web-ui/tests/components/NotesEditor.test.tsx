import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NotesEditor } from "../../src/components/evidence/NotesEditor";
import { ToastProvider } from "../../src/components/ui/ToastProvider";

function wrap(ui: React.ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

describe("NotesEditor", () => {
  it("renders empty form when notes is null", () => {
    wrap(<NotesEditor
      caseId="case-01"
      notes={null}
      screenshotFiles={[]}
      generatedFiles={[]}
      onSave={async () => {}}
    />);
    expect(screen.getByText(/duration_min/)).toBeInTheDocument();
    expect(screen.getByText(/Observations/)).toBeInTheDocument();
  });

  it("calls onSave with frontmatter + body", async () => {
    const onSave = vi.fn(async () => {});
    wrap(<NotesEditor
      caseId="case-01"
      notes={{
        frontmatter: { type: "evidence_notes", case_id: "case-01", duration_min: 30 },
        body: "existing body",
      }}
      screenshotFiles={[]}
      generatedFiles={[]}
      onSave={onSave}
    />);
    fireEvent.click(screen.getByRole("button", { name: /保存笔记/ }));
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
        frontmatter: expect.objectContaining({
          type: "evidence_notes",
          case_id: "case-01",
          duration_min: 30,
        }),
        body: "existing body",
      }));
    });
  });

  it("adds and removes observation", async () => {
    const onSave = vi.fn(async () => {});
    wrap(<NotesEditor
      caseId="case-01"
      notes={null}
      screenshotFiles={[]}
      generatedFiles={[]}
      onSave={onSave}
    />);
    fireEvent.click(screen.getByRole("button", { name: /\+ 添加 observation/ }));
    const pointInputs = screen.getAllByPlaceholderText(/observation/);
    fireEvent.change(pointInputs[0]!, { target: { value: "new point" } });
    fireEvent.click(screen.getByRole("button", { name: /保存笔记/ }));
    await waitFor(() => {
      const arg = onSave.mock.calls[0]![0];
      expect(arg.frontmatter.observations).toHaveLength(1);
      expect(arg.frontmatter.observations[0].point).toBe("new point");
    });
  });
});

import { useState } from "react";
import type { Project } from "../../api/types";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";

export interface DeleteProjectModalProps {
  project: Project;
  onCancel: () => void;
  onConfirm: (slug: string) => void;
}

export function DeleteProjectModal({ project, onCancel, onConfirm }: DeleteProjectModalProps) {
  const [value, setValue] = useState("");
  const matches = value === project.slug;

  return (
    <div
      data-testid="delete-project-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-bg-1 border border-hair rounded-[2px] p-6 w-[420px] flex flex-col gap-4">
        <h3 className="text-heading text-[15px] font-semibold m-0">
          删除项目「{project.name}」？
        </h3>
        <p className="text-[13px] text-meta m-0">
          此操作不可恢复。项目目录及其所有资产（简报 / 案例 / 图片 / 稿件）将被永久删除。
        </p>
        <p className="text-[13px] text-body m-0">
          请输入项目 slug <code className="bg-bg-2 px-1">{project.slug}</code> 确认删除：
        </p>
        <Input
          data-testid="confirm-slug-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={project.slug}
        />
        <div className="flex justify-end gap-2 mt-2">
          <Button variant="secondary" onClick={onCancel} data-testid="cancel-delete-btn">
            取消
          </Button>
          <button
            data-testid="confirm-delete-btn"
            disabled={!matches}
            onClick={() => onConfirm(value)}
            className={`px-4 py-2 text-[13px] rounded-[2px] ${matches ? "bg-[var(--red)] text-white hover:shadow-[0_0_12px_rgba(255,107,107,0.4)]" : "bg-bg-2 text-meta cursor-not-allowed"}`}
          >
            删除
          </button>
        </div>
      </div>
    </div>
  );
}

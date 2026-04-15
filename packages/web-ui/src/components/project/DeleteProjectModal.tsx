import type { Project } from "../../api/types";
export interface DeleteProjectModalProps {
  project: Project;
  onCancel: () => void;
  onConfirm: (slug: string) => void;
}
export function DeleteProjectModal(_props: DeleteProjectModalProps) {
  return null;
}

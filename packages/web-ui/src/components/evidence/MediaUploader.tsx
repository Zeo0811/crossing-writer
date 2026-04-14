import { FileUploader } from "./FileUploader";
import type { FileInfo } from "../../api/evidence-client";

export function MediaUploader(props: {
  files: FileInfo[];
  onUpload: (file: File) => Promise<void>;
  onDelete: (filename: string) => Promise<void>;
}) {
  return (
    <FileUploader
      label="🎨 产品产出"
      accept="*/*"
      hint="图/视频/音频/文本，≤200MB"
      {...props}
    />
  );
}

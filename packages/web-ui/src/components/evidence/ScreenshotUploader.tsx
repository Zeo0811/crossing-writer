import { FileUploader } from "./FileUploader";
import type { FileInfo } from "../../api/evidence-client";

export function ScreenshotUploader(props: {
  files: FileInfo[];
  onUpload: (file: File) => Promise<void>;
  onDelete: (filename: string) => Promise<void>;
}) {
  return (
    <FileUploader
      label="📷 过程截图"
      accept="image/png,image/jpeg,image/webp"
      hint="png/jpg/webp，≤10MB"
      {...props}
    />
  );
}

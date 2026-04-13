import { FileUploader } from "./FileUploader";
import type { FileInfo } from "../../api/evidence-client";

export function RecordingUploader(props: {
  files: FileInfo[];
  onUpload: (file: File) => Promise<void>;
  onDelete: (filename: string) => Promise<void>;
}) {
  return (
    <FileUploader
      label="🎬 录屏"
      accept="video/mp4,video/quicktime,video/webm"
      hint="mp4/mov/webm，≤100MB"
      {...props}
    />
  );
}

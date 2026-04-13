import { extname } from "node:path";

export async function extractToMarkdown(buffer: Buffer, filename: string): Promise<string> {
  const ext = extname(filename).toLowerCase();
  switch (ext) {
    case ".md":
    case ".markdown":
      return buffer.toString("utf-8");
    case ".txt":
      return buffer.toString("utf-8");
    case ".docx": {
      const mammoth = (await import("mammoth")).default;
      const result = await mammoth.convertToMarkdown({ buffer });
      return result.value;
    }
    case ".pdf": {
      const pdf = (await import("pdf-parse")).default;
      const result = await pdf(buffer);
      return result.text;
    }
    default:
      throw new Error(`unsupported file type: ${ext}`);
  }
}

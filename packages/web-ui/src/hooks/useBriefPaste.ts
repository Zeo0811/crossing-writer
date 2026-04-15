import { useEffect, useRef, type RefObject } from "react";
import {
  uploadBriefAttachment,
  briefAttachmentMarkdown,
  type BriefAttachmentItem,
} from "../api/writer-client";

export interface UseBriefPasteOptions {
  projectId: string;
  /** insert markdown at current caret of the textarea ref */
  onInsert: (markdown: string) => void;
  onError?: (err: Error) => void;
  onUploaded?: (items: BriefAttachmentItem[]) => void;
}

export function useBriefPaste(
  ref: RefObject<HTMLTextAreaElement | null>,
  opts: UseBriefPasteOptions,
): void {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onPaste = async (e: ClipboardEvent) => {
      const cd = e.clipboardData;
      if (!cd) return;
      const files: File[] = [];
      const items = cd.items ? Array.from(cd.items) : [];
      for (const item of items) {
        if (item.kind === "file") {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length === 0 && cd.files && cd.files.length > 0) {
        for (const f of Array.from(cd.files)) files.push(f);
      }
      if (files.length === 0) return;
      e.preventDefault();
      try {
        const res = await uploadBriefAttachment(optsRef.current.projectId, files);
        for (const it of res.items) {
          optsRef.current.onInsert(
            briefAttachmentMarkdown(it, optsRef.current.projectId),
          );
        }
        optsRef.current.onUploaded?.(res.items);
      } catch (err: any) {
        optsRef.current.onError?.(
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    };

    el.addEventListener("paste", onPaste as EventListener);
    return () => {
      el.removeEventListener("paste", onPaste as EventListener);
    };
  }, [ref]);
}

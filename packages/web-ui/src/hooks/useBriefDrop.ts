import { useEffect, useRef, useState, type RefObject } from "react";
import {
  uploadBriefAttachment,
  briefAttachmentMarkdown,
  type BriefAttachmentItem,
} from "../api/writer-client";

export interface UseBriefDropOptions {
  projectId: string;
  onInsert: (markdown: string) => void;
  onError?: (err: Error) => void;
  onUploaded?: (items: BriefAttachmentItem[]) => void;
}

export interface UseBriefDropResult {
  isDragging: boolean;
  uploading: boolean;
  uploadTotal: number;
  uploadDone: number;
}

export function useBriefDrop(
  ref: RefObject<HTMLElement | null>,
  opts: UseBriefDropOptions,
): UseBriefDropResult {
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadTotal, setUploadTotal] = useState(0);
  const [uploadDone, setUploadDone] = useState(0);
  const dragCounter = useRef(0);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(true);
    };
    const onDragEnter = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current += 1;
      setIsDragging(true);
    };
    const onDragLeave = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current -= 1;
      if (dragCounter.current <= 0) {
        dragCounter.current = 0;
        setIsDragging(false);
      }
    };
    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current = 0;
      setIsDragging(false);
      const dt = e.dataTransfer;
      if (!dt) return;
      const files = Array.from(dt.files ?? []);
      if (files.length === 0) return;
      setUploading(true);
      setUploadTotal(files.length);
      setUploadDone(0);
      const collected: BriefAttachmentItem[] = [];
      try {
        // upload one at a time to allow partial-failure handling and progress
        for (const file of files) {
          try {
            const res = await uploadBriefAttachment(
              optsRef.current.projectId,
              [file],
            );
            for (const it of res.items) {
              optsRef.current.onInsert(
                briefAttachmentMarkdown(it, optsRef.current.projectId) + "\n",
              );
              collected.push(it);
            }
          } catch (err: any) {
            optsRef.current.onError?.(
              err instanceof Error ? err : new Error(String(err)),
            );
          }
          setUploadDone((n) => n + 1);
        }
        if (collected.length > 0) optsRef.current.onUploaded?.(collected);
      } finally {
        setUploading(false);
        setUploadTotal(0);
        setUploadDone(0);
      }
    };

    el.addEventListener("dragover", onDragOver);
    el.addEventListener("dragenter", onDragEnter);
    el.addEventListener("dragleave", onDragLeave);
    el.addEventListener("drop", onDrop);
    return () => {
      el.removeEventListener("dragover", onDragOver);
      el.removeEventListener("dragenter", onDragEnter);
      el.removeEventListener("dragleave", onDragLeave);
      el.removeEventListener("drop", onDrop);
    };
  }, [ref]);

  return { isDragging, uploading, uploadTotal, uploadDone };
}

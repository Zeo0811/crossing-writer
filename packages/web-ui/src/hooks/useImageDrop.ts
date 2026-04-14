import { useEffect, useRef, useState, type RefObject } from "react";
import { uploadImage } from "../api/writer-client";

export interface UseImageDropOptions {
  projectId: string;
  onInsert: (markdown: string) => void;
  onError?: (err: Error) => void;
}

export interface UseImageDropResult {
  isDragging: boolean;
  uploading: boolean;
  uploadTotal: number;
  uploadDone: number;
}

export function useImageDrop(
  ref: RefObject<HTMLElement | null>,
  opts: UseImageDropOptions,
): UseImageDropResult {
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
      const files: File[] = [];
      for (const f of Array.from(dt.files ?? [])) {
        if (f.type.startsWith("image/")) files.push(f);
      }
      if (files.length === 0) return;
      setUploading(true);
      setUploadTotal(files.length);
      setUploadDone(0);
      try {
        for (const file of files) {
          try {
            const res = await uploadImage(optsRef.current.projectId, file);
            optsRef.current.onInsert(`![${file.name}](${res.url})\n`);
          } catch (err: any) {
            optsRef.current.onError?.(err instanceof Error ? err : new Error(String(err)));
          }
          setUploadDone((n) => n + 1);
        }
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

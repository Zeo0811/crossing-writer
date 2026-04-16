import { useEffect, useRef, useState } from "react";
import {
  uploadOverviewImage, listOverviewImages,
  deleteOverviewImage, generateOverview,
} from "../../api/client";
import type { ProjectImage } from "../../api/types";
import { ActionButton } from "../ui/ActionButton";

export function OverviewIntakeForm({ projectId }: { projectId: string }) {
  const [images, setImages] = useState<ProjectImage[]>([]);
  const [urls, setUrls] = useState<string[]>([]);
  const [urlDraft, setUrlDraft] = useState("");
  const [desc, setDesc] = useState("");
  const briefInputRef = useRef<HTMLInputElement>(null);
  const screenshotInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listOverviewImages(projectId).then(setImages).catch(() => {});
  }, [projectId]);

  async function onUpload(source: "brief" | "screenshot", fl: FileList | null) {
    if (!fl) return;
    for (const f of Array.from(fl)) {
      const info = await uploadOverviewImage(projectId, f, source);
      setImages((prev) => [...prev, info]);
    }
  }

  async function onDelete(filename: string) {
    await deleteOverviewImage(projectId, filename);
    setImages((prev) => prev.filter((i) => i.filename !== filename));
  }

  function addUrl() {
    const v = urlDraft.trim();
    if (!v) return;
    setUrls([...urls, v]);
    setUrlDraft("");
  }

  async function submit() {
    await generateOverview(projectId, {
      productUrls: urls,
      userDescription: desc || undefined,
    });
  }

  const briefImgs = images.filter((i) => i.source === "brief");
  const screenshotImgs = images.filter((i) => i.source === "screenshot");

  return (
    <div className="space-y-4">
      <ImageSection
        projectId={projectId}
        label="Brief 配图"
        images={briefImgs}
        onPick={() => briefInputRef.current?.click()}
        onDelete={onDelete}
        inputRef={briefInputRef}
        onChange={(fl) => onUpload("brief", fl)}
      />
      <ImageSection
        projectId={projectId}
        label="产品截图"
        images={screenshotImgs}
        onPick={() => screenshotInputRef.current?.click()}
        onDelete={onDelete}
        inputRef={screenshotInputRef}
        onChange={(fl) => onUpload("screenshot", fl)}
      />

      <section className="space-y-2">
        <div className="text-xs text-[var(--meta)] font-semibold">产品文档 URL</div>
        <div className="flex gap-2">
          <input
            className="flex-1 bg-[var(--bg-2)] border border-[var(--hair)] rounded px-3 py-2 text-sm text-[var(--body)] outline-none focus:border-[var(--accent-soft)]"
            placeholder="https://…"
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addUrl(); }}
          />
          <button
            onClick={addUrl}
            className="px-3 py-1.5 text-xs rounded border border-[var(--hair-strong)] text-[var(--meta)] hover:text-[var(--heading)]"
          >
            添加
          </button>
        </div>
        {urls.length > 0 && (
          <ul className="space-y-1">
            {urls.map((u, idx) => (
              <li key={idx} className="flex items-center gap-2 text-sm px-3 py-2 rounded bg-[var(--bg-2)]">
                <span className="flex-1 truncate text-[var(--body)]">{u}</span>
                <button
                  onClick={() => setUrls(urls.filter((_, i) => i !== idx))}
                  className="text-[var(--meta)] hover:text-[var(--red)]"
                  aria-label="remove url"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <div className="text-xs text-[var(--meta)] font-semibold">补充描述（可选）</div>
        <textarea
          className="w-full bg-[var(--bg-2)] border border-[var(--hair)] rounded px-3 py-2 text-sm text-[var(--body)] outline-none focus:border-[var(--accent-soft)] resize-y"
          rows={3}
          placeholder="想强调的角度…"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
        />
      </section>

      <div className="flex justify-end">
        <ActionButton
          onClick={submit}
          disabled={images.length === 0}
          successMsg="已开始生成概览"
          errorMsg={(e) => `生成失败：${String(e)}`}
        >
          生成产品概览 →
        </ActionButton>
      </div>
    </div>
  );
}

function ImageSection({
  projectId, label, images, onPick, onDelete, inputRef, onChange,
}: {
  projectId: string;
  label: string;
  images: ProjectImage[];
  onPick: () => void;
  onDelete: (filename: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onChange: (fl: FileList | null) => void;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs text-[var(--meta)] font-semibold">{label} ({images.length})</div>
        <button onClick={onPick} className="text-xs text-[var(--accent)] hover:underline">＋ 添加图片</button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*"
          hidden
          onChange={(e) => onChange(e.target.files)}
        />
      </div>
      {images.length > 0 ? (
        <div className="grid grid-cols-4 gap-2">
          {images.map((i) => (
            <div key={i.filename} className="relative group rounded bg-[var(--bg-2)] border border-[var(--hair)] overflow-hidden">
              <div className="aspect-video bg-[var(--bg-1)] overflow-hidden">
                <img
                  src={`/api/projects/${encodeURIComponent(projectId)}/overview/images/${encodeURIComponent(i.filename)}`}
                  alt={i.filename}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </div>
              <div className="px-2 py-1.5 text-[11px] text-[var(--body)] truncate" title={i.filename}>{i.filename}</div>
              <button
                onClick={() => onDelete(i.filename)}
                className="absolute top-1 right-1 w-6 h-6 flex items-center justify-center rounded-full bg-[rgba(0,0,0,0.6)] text-white hover:bg-[var(--red)] opacity-0 group-hover:opacity-100 transition-opacity text-xs"
                aria-label={`删除 ${i.filename}`}
                title={`删除 ${i.filename}`}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div
          onClick={onPick}
          className="rounded border border-dashed border-[var(--hair-strong)] py-6 text-center text-sm text-[var(--meta)] cursor-pointer hover:border-[var(--accent-soft)] hover:bg-[var(--bg-2)]"
        >
          点击上传
        </div>
      )}
    </section>
  );
}

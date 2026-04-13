import { useEffect, useState } from "react";
import {
  uploadOverviewImage, listOverviewImages,
  deleteOverviewImage, generateOverview,
} from "../../api/client";
import type { ProjectImage } from "../../api/types";

export function OverviewIntakeForm({ projectId }: { projectId: string }) {
  const [images, setImages] = useState<ProjectImage[]>([]);
  const [urls, setUrls] = useState<string[]>([]);
  const [urlDraft, setUrlDraft] = useState("");
  const [desc, setDesc] = useState("");
  const [submitting, setSubmitting] = useState(false);

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
    setSubmitting(true);
    try {
      await generateOverview(projectId, {
        productUrls: urls,
        userDescription: desc || undefined,
      });
    } finally {
      setSubmitting(false);
    }
  }

  const briefImgs = images.filter((i) => i.source === "brief");
  const screenshotImgs = images.filter((i) => i.source === "screenshot");

  return (
    <div className="space-y-4 p-4">
      <section>
        <h3 className="font-semibold">Brief 配图</h3>
        <input type="file" multiple accept="image/*"
          onChange={(e) => onUpload("brief", e.target.files)} />
        <div className="grid grid-cols-3 gap-2 mt-2">
          {briefImgs.map((i) => (
            <div key={i.filename} className="border p-1 text-xs">
              {i.filename}
              <button onClick={() => onDelete(i.filename)}>删</button>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="font-semibold">产品截图</h3>
        <input type="file" multiple accept="image/*"
          onChange={(e) => onUpload("screenshot", e.target.files)} />
        <div className="grid grid-cols-3 gap-2 mt-2">
          {screenshotImgs.map((i) => (
            <div key={i.filename} className="border p-1 text-xs">
              {i.filename}
              <button onClick={() => onDelete(i.filename)}>删</button>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="font-semibold">产品文档 URL</h3>
        <div className="flex gap-2">
          <input className="flex-1 border px-2" placeholder="https://..."
            value={urlDraft} onChange={(e) => setUrlDraft(e.target.value)} />
          <button onClick={addUrl}>添加</button>
        </div>
        <ul className="mt-2 text-sm">
          {urls.map((u, idx) => (
            <li key={idx}>
              {u}
              <button onClick={() => setUrls(urls.filter((_, i) => i !== idx))}>🗑</button>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="font-semibold">补充描述（可选）</h3>
        <textarea className="w-full border p-2" rows={4}
          placeholder="补充描述"
          value={desc} onChange={(e) => setDesc(e.target.value)} />
      </section>

      <button className="bg-blue-600 text-white px-4 py-2"
        disabled={submitting} onClick={submit}>
        生成产品概览
      </button>
    </div>
  );
}

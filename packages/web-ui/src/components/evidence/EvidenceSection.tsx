import { useEffect, useRef, useState } from "react";
import {
  submitEvidence,
  getCaseEvidence,
  uploadEvidenceFile,
  deleteEvidenceFile,
  getNotes,
  putNotes,
  type CaseDetail,
  type EvidenceKind,
} from "../../api/evidence-client";
import { useProjectEvidence } from "../../hooks/useProjectEvidence";
import { ActionButton } from "../ui/ActionButton";

const KIND_LABEL: Record<EvidenceKind, string> = {
  screenshot: "截图",
  recording: "录屏 / 视频",
  generated: "产出物",
};

export function EvidenceSection({
  projectId,
  selectedCaseId,
  onSelectCase,
}: {
  projectId: string;
  selectedCaseId: string | null;
  onSelectCase: (caseId: string) => void;
}) {
  const { evidence, reload } = useProjectEvidence(projectId);

  if (!evidence) return <div className="text-sm text-[var(--meta)]">加载中…</div>;

  const entries = Object.entries(evidence.cases);
  const completeCount = entries.filter(([, v]) => v.complete).length;
  const total = entries.length;
  const progress = total === 0 ? 0 : Math.round((completeCount / total) * 100);

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {entries.map(([caseId, c]) => {
          const sel = caseId === selectedCaseId;
          return (
            <li key={caseId} data-testid={`case-row-${caseId}`}>
              <button
                type="button"
                onClick={() => onSelectCase(sel ? "" : caseId)}
                className={`w-full text-left rounded-lg border transition-colors ${
                  sel ? "border-[var(--accent)] bg-[var(--accent-fill)]" : c.complete ? "border-[var(--accent-soft)] bg-[var(--bg-1)]" : "border-[var(--hair)] bg-[var(--bg-1)] hover:border-[var(--accent-soft)]"
                }`}
              >
                <div className="flex items-center gap-3 p-3">
                  <StatusDot complete={c.complete} missing={!c.has_screenshot || !c.has_notes || !c.has_generated} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono-term text-sm text-[var(--heading)] font-semibold">{caseId}</span>
                      {c.complete && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent)] text-[var(--accent-on)] font-semibold uppercase tracking-wider font-mono-term">完成</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-[var(--meta)]">
                      <KindBadge on={c.has_screenshot} label="截图" count={c.counts.screenshots} />
                      <KindBadge on={c.counts.recordings > 0} label="录屏" count={c.counts.recordings} />
                      <KindBadge on={c.has_generated} label="产出" count={c.counts.generated} />
                      <KindBadge on={c.has_notes} label="笔记" />
                    </div>
                  </div>
                  <span className="text-[var(--faint)] text-sm">{sel ? "▴" : "▾"}</span>
                </div>
              </button>
              {sel && (
                <CaseUploader projectId={projectId} caseId={caseId} onChange={reload} />
              )}
            </li>
          );
        })}
      </ul>

      <div className="flex items-center justify-between gap-4 pt-3 border-t border-[var(--hair)]">
        <div className="flex-1">
          <div className="flex items-center gap-2 text-xs text-[var(--meta)] mb-1">
            <span>进度：{completeCount} / {total} 完整</span>
            <span className="font-mono-term text-[var(--accent)]">{progress}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-[var(--bg-2)] overflow-hidden">
            <div className="h-full bg-[var(--accent)] transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
        <ActionButton
          onClick={async () => { await submitEvidence(projectId); reload(); }}
          disabled={!evidence.all_complete || evidence.submitted_at !== null}
          successMsg="已提交 Evidence"
          errorMsg={(e) => `提交失败：${String(e)}`}
        >
          {evidence.submitted_at ? "已提交" : "提交 Evidence →"}
        </ActionButton>
      </div>
    </div>
  );
}

function StatusDot({ complete, missing }: { complete: boolean; missing: boolean }) {
  return (
    <span className={`shrink-0 w-2 h-2 rounded-full ${
      complete ? "bg-[var(--accent)]" : missing ? "bg-[var(--amber)]" : "bg-[var(--hair-strong)]"
    }`} />
  );
}

function KindBadge({ on, label, count }: { on: boolean; label: string; count?: number }) {
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] ${
      on ? "bg-[var(--accent-fill)] text-[var(--accent)]" : "bg-[var(--bg-2)] text-[var(--faint)]"
    }`}>
      <span>{label}</span>
      {typeof count === "number" && <span className="font-mono-term">{count}</span>}
    </span>
  );
}

function CaseUploader({
  projectId,
  caseId,
  onChange,
}: {
  projectId: string;
  caseId: string;
  onChange: () => void;
}) {
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [notesBody, setNotesBody] = useState<string>("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reloadDetail = async () => {
    try {
      const d = await getCaseEvidence(projectId, caseId);
      setDetail(d);
      const notes = await getNotes(projectId, caseId).catch(() => null);
      if (notes) setNotesBody(notes.body ?? "");
      else setNotesBody("");
    } catch (e: any) { setErr(String(e?.message ?? e)); }
  };

  useEffect(() => { void reloadDetail(); }, [projectId, caseId]);

  const onUpload = async (kind: EvidenceKind, files: FileList | null) => {
    if (!files || files.length === 0) return;
    setErr(null);
    try {
      for (const f of Array.from(files)) {
        await uploadEvidenceFile(projectId, caseId, kind, f);
      }
      await reloadDetail();
      onChange();
    } catch (e: any) { setErr(String(e?.message ?? e)); }
  };

  const onDelete = async (kind: EvidenceKind, filename: string) => {
    setErr(null);
    try {
      await deleteEvidenceFile(projectId, caseId, kind, filename);
      await reloadDetail();
      onChange();
    } catch (e: any) { setErr(String(e?.message ?? e)); }
  };

  const saveNotes = async () => {
    setSavingNotes(true);
    setErr(null);
    try {
      await putNotes(projectId, caseId, { frontmatter: {}, body: notesBody });
      await reloadDetail();
      onChange();
    } catch (e: any) { setErr(String(e?.message ?? e)); }
    finally { setSavingNotes(false); }
  };

  if (!detail) return (
    <div className="mt-2 p-4 rounded border border-[var(--hair)] bg-[var(--bg-0)] text-xs text-[var(--faint)]">加载中…</div>
  );

  return (
    <div className="mt-2 p-4 rounded border border-[var(--hair)] bg-[var(--bg-0)] space-y-4" onClick={(e) => e.stopPropagation()}>
      {detail.name && (
        <div className="text-sm text-[var(--body)] leading-relaxed pl-3 border-l-2 border-[var(--accent-soft)]">
          {detail.name}
        </div>
      )}

      <UploadPane
        projectId={projectId}
        caseId={caseId}
        kind="screenshot"
        accept="image/*"
        files={detail.screenshots}
        onUpload={onUpload}
        onDelete={onDelete}
      />
      <UploadPane
        projectId={projectId}
        caseId={caseId}
        kind="recording"
        accept="video/*,audio/*"
        files={detail.recordings}
        onUpload={onUpload}
        onDelete={onDelete}
      />
      <UploadPane
        projectId={projectId}
        caseId={caseId}
        kind="generated"
        accept="*/*"
        files={detail.generated}
        onUpload={onUpload}
        onDelete={onDelete}
      />

      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs text-[var(--meta)] font-semibold uppercase tracking-wider">实测笔记</div>
          <button
            type="button"
            onClick={() => { void saveNotes(); }}
            disabled={savingNotes}
            className="text-xs text-[var(--accent)] hover:underline disabled:opacity-50"
          >
            {savingNotes ? "保存中…" : "保存笔记"}
          </button>
        </div>
        <textarea
          value={notesBody}
          onChange={(e) => setNotesBody(e.target.value)}
          placeholder="记录：实测中遇到的卡点 / 超预期的地方 / 产品真实表现..."
          className="w-full min-h-[100px] p-3 rounded border border-[var(--hair)] bg-[var(--bg-1)] text-sm text-[var(--body)] outline-none focus:border-[var(--accent-soft)]"
        />
      </div>

      {err && <div className="text-xs text-[var(--red)]">错误：{err}</div>}
    </div>
  );
}

function UploadPane({
  projectId,
  caseId,
  kind,
  accept,
  files,
  onUpload,
  onDelete,
}: {
  projectId: string;
  caseId: string;
  kind: EvidenceKind;
  accept: string;
  files: Array<{ filename: string; size: number; relPath: string }>;
  onUpload: (kind: EvidenceKind, files: FileList | null) => void;
  onDelete: (kind: EvidenceKind, filename: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const isImage = kind === "screenshot";

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-[var(--meta)] font-semibold uppercase tracking-wider">
          {KIND_LABEL[kind]} <span className="text-[var(--faint)] font-normal ml-1 font-mono-term">{files.length}</span>
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="text-xs text-[var(--accent)] hover:underline"
        >
          ＋ 添加{KIND_LABEL[kind]}
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={accept}
          hidden
          onChange={(e) => { onUpload(kind, e.target.files); if (inputRef.current) inputRef.current.value = ""; }}
        />
      </div>

      {files.length > 0 ? (
        isImage ? (
          <div className="grid grid-cols-4 gap-2">
            {files.map((f) => (
              <div key={f.filename} className="relative group rounded bg-[var(--bg-2)] border border-[var(--hair)] overflow-hidden">
                <div className="aspect-video bg-[var(--bg-1)] overflow-hidden">
                  <img
                    src={`/api/projects/${encodeURIComponent(projectId)}/evidence/${encodeURIComponent(caseId)}/files/${kind}/${encodeURIComponent(f.filename)}`}
                    alt={f.filename}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </div>
                <div className="px-2 py-1.5 text-[10px] text-[var(--body)] truncate" title={f.filename}>{f.filename}</div>
                <button
                  onClick={() => onDelete(kind, f.filename)}
                  className="absolute top-1 right-1 w-6 h-6 flex items-center justify-center rounded-full bg-[rgba(0,0,0,0.6)] text-white hover:bg-[var(--red)] opacity-0 group-hover:opacity-100 transition-opacity text-xs"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        ) : (
          <ul className="space-y-1.5">
            {files.map((f) => (
              <li key={f.filename} className="flex items-center gap-3 px-3 py-2 rounded bg-[var(--bg-2)] text-sm">
                <span className="text-[var(--accent)]">{kind === "recording" ? "🎬" : "📄"}</span>
                <span className="flex-1 truncate text-[var(--body)]" title={f.filename}>{f.filename}</span>
                <span className="text-xs text-[var(--faint)] font-mono-term">{Math.round(f.size / 1024)} KB</span>
                <button
                  onClick={() => onDelete(kind, f.filename)}
                  className="text-[var(--meta)] hover:text-[var(--red)]"
                  aria-label={`删除 ${f.filename}`}
                >✕</button>
              </li>
            ))}
          </ul>
        )
      ) : (
        <div
          onClick={() => inputRef.current?.click()}
          className="rounded border border-dashed border-[var(--hair-strong)] py-6 text-center text-xs text-[var(--meta)] cursor-pointer hover:border-[var(--accent-soft)] hover:bg-[var(--bg-2)]"
        >
          点击上传 {KIND_LABEL[kind]}
        </div>
      )}
    </section>
  );
}

import { useEvidence } from "../../hooks/useEvidence";
import { uploadEvidenceFile, deleteEvidenceFile, putNotes } from "../../api/evidence-client";
import { ScreenshotUploader } from "./ScreenshotUploader";
import { RecordingUploader } from "./RecordingUploader";
import { MediaUploader } from "./MediaUploader";
import { NotesEditor } from "./NotesEditor";
import { CaseCompletenessBadge } from "./CaseCompletenessBadge";

export function EvidenceIntakeForm({ projectId, caseId }: { projectId: string; caseId: string }) {
  const { detail, loading, reload } = useEvidence(projectId, caseId);

  if (loading || !detail) return <div className="p-4 text-xs text-gray-500">加载 Case 详情…</div>;

  return (
    <div className="space-y-4 p-4">
      <header className="flex items-center justify-between border-b pb-2">
        <h3 className="font-semibold">{detail.case_id} — {detail.name}</h3>
        <CaseCompletenessBadge completeness={detail.completeness} />
      </header>

      <ScreenshotUploader
        files={detail.screenshots}
        onUpload={async (f) => { await uploadEvidenceFile(projectId, caseId, "screenshot", f); reload(); }}
        onDelete={async (n) => { await deleteEvidenceFile(projectId, caseId, "screenshot", n); reload(); }}
      />

      <RecordingUploader
        files={detail.recordings}
        onUpload={async (f) => { await uploadEvidenceFile(projectId, caseId, "recording", f); reload(); }}
        onDelete={async (n) => { await deleteEvidenceFile(projectId, caseId, "recording", n); reload(); }}
      />

      <MediaUploader
        files={detail.generated}
        onUpload={async (f) => { await uploadEvidenceFile(projectId, caseId, "generated", f); reload(); }}
        onDelete={async (n) => { await deleteEvidenceFile(projectId, caseId, "generated", n); reload(); }}
      />

      <NotesEditor
        caseId={caseId}
        notes={detail.notes}
        screenshotFiles={detail.screenshots}
        generatedFiles={detail.generated}
        onSave={async (data) => { await putNotes(projectId, caseId, data); reload(); }}
      />
    </div>
  );
}

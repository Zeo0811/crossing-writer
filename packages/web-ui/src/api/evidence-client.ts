export type EvidenceKind = "screenshot" | "recording" | "generated";

export interface FileInfo {
  filename: string;
  relPath: string;
  size: number;
  uploaded_at: string;
}

export interface CompletenessResult {
  complete: boolean;
  missing: Array<"screenshot" | "notes" | "generated">;
  has_screenshot: boolean;
  has_notes: boolean;
  has_generated: boolean;
}

export interface CaseDetail {
  case_id: string;
  name: string;
  screenshots: FileInfo[];
  recordings: FileInfo[];
  generated: FileInfo[];
  notes: { frontmatter: Record<string, any>; body: string } | null;
  completeness: CompletenessResult;
}

export interface ProjectEvidence {
  cases: Record<string, {
    has_screenshot: boolean;
    has_notes: boolean;
    has_generated: boolean;
    complete: boolean;
    counts: { screenshots: number; recordings: number; generated: number };
    last_updated_at: string;
  }>;
  all_complete: boolean;
  submitted_at: string | null;
  index_path: string;
}

export async function getProjectEvidence(projectId: string): Promise<ProjectEvidence> {
  const res = await fetch(`/api/projects/${projectId}/evidence`);
  if (!res.ok) throw new Error(`get evidence failed: ${res.status}`);
  const data = await res.json();
  // backend returns cases as object keyed by case_id with full structure;
  // adapt to flat completeness flags + counts shape used by ProjectEvidence
  const casesOut: ProjectEvidence["cases"] = {};
  for (const [k, v] of Object.entries<any>(data.cases)) {
    casesOut[k] = {
      has_screenshot: v.completeness?.has_screenshot ?? v.has_screenshot,
      has_notes: v.completeness?.has_notes ?? v.has_notes,
      has_generated: v.completeness?.has_generated ?? v.has_generated,
      complete: v.completeness?.complete ?? v.complete,
      counts: v.counts,
      last_updated_at: v.last_updated_at ?? data.updated_at ?? "",
    };
  }
  return {
    cases: casesOut,
    all_complete: data.all_complete,
    submitted_at: data.submitted_at,
    index_path: data.index_path,
  };
}

export async function getCaseEvidence(projectId: string, caseId: string): Promise<CaseDetail> {
  const res = await fetch(`/api/projects/${projectId}/evidence/${caseId}`);
  if (!res.ok) throw new Error(`get case evidence failed: ${res.status}`);
  return res.json();
}

export async function uploadEvidenceFile(
  projectId: string,
  caseId: string,
  kind: EvidenceKind,
  file: File,
): Promise<FileInfo & { kind: EvidenceKind }> {
  const fd = new FormData();
  fd.append("kind", kind);
  fd.append("file", file);
  const res = await fetch(`/api/projects/${projectId}/evidence/${caseId}/files`, {
    method: "POST", body: fd,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `upload failed: ${res.status}`);
  }
  return res.json();
}

export async function deleteEvidenceFile(
  projectId: string,
  caseId: string,
  kind: EvidenceKind,
  filename: string,
): Promise<void> {
  const res = await fetch(
    `/api/projects/${projectId}/evidence/${caseId}/files/${kind}/${filename}`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error(`delete failed: ${res.status}`);
}

export async function getNotes(projectId: string, caseId: string): Promise<{ frontmatter: Record<string, any>; body: string } | null> {
  const res = await fetch(`/api/projects/${projectId}/evidence/${caseId}/notes`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`get notes failed: ${res.status}`);
  return res.json();
}

export async function putNotes(
  projectId: string,
  caseId: string,
  data: { frontmatter: Record<string, any>; body: string },
): Promise<void> {
  const res = await fetch(`/api/projects/${projectId}/evidence/${caseId}/notes`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `put notes failed: ${res.status}`);
  }
}

export async function submitEvidence(projectId: string): Promise<void> {
  const res = await fetch(`/api/projects/${projectId}/evidence/submit`, { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `submit failed: ${res.status}`);
  }
}

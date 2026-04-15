import type { Project, Expert, ProjectImage, OverviewGenerateBody, CaseExpertInfo } from "./types";

export type { CaseExpertInfo };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return res.json() as Promise<T>;
  return res.text() as unknown as Promise<T>;
}

export const api = {
  listProjects: () => request<{ items: Project[]; archived_count: number }>("/api/projects"),
  listArchivedProjects: () =>
    request<{ items: Project[]; active_count: number }>("/api/projects?only_archived=1"),
  archiveProject: (id: string) =>
    request<{ ok: true; id: string }>(`/api/projects/${id}/archive`, { method: "POST" }),
  restoreProject: (id: string) =>
    request<{ ok: true; id: string }>(`/api/projects/${id}/restore`, { method: "POST" }),
  destroyProject: (id: string, confirm: string) =>
    request<{ ok: true; id: string }>(`/api/projects/${id}`, {
      method: "DELETE",
      body: JSON.stringify({ confirm }),
    }),
  createProject: (name: string) =>
    request<Project>("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  getProject: (id: string) => request<Project>(`/api/projects/${id}`),
  uploadBriefText: (
    id: string,
    body: {
      text: string;
      productName?: string;
      productUrl?: string;
      notes?: string;
    },
  ) =>
    request<{ ok: true }>(`/api/projects/${id}/brief`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  uploadBriefFile: (
    id: string,
    file: File,
    extra: { productName?: string; productUrl?: string; notes?: string },
  ) => {
    const fd = new FormData();
    fd.append("file", file);
    for (const [k, v] of Object.entries(extra)) {
      if (v) fd.append(k, v);
    }
    return fetch(`/api/projects/${id}/brief`, {
      method: "POST",
      body: fd,
    }).then((r) => {
      if (!r.ok) throw new Error(`${r.status}`);
      return r.json() as Promise<{ ok: true }>;
    });
  },
  getBriefSummary: (id: string) =>
    request<string>(`/api/projects/${id}/brief-summary`),
  listExperts: () =>
    request<{ topic_panel: Expert[] }>("/api/experts"),
};

export async function uploadOverviewImage(
  projectId: string,
  file: File,
  source: "brief" | "screenshot",
  label?: string,
): Promise<ProjectImage> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("source", source);
  if (label) fd.append("label", label);
  const res = await fetch(`/api/projects/${projectId}/overview/images`, {
    method: "POST", body: fd,
  });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  return res.json();
}

export async function listOverviewImages(projectId: string): Promise<ProjectImage[]> {
  const res = await fetch(`/api/projects/${projectId}/overview/images`);
  return res.json();
}

export async function deleteOverviewImage(projectId: string, filename: string): Promise<void> {
  const res = await fetch(`/api/projects/${projectId}/overview/images/${filename}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`delete failed: ${res.status}`);
}

export async function generateOverview(
  projectId: string, body: OverviewGenerateBody,
): Promise<{ ok: true }> {
  const res = await fetch(`/api/projects/${projectId}/overview/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`generate failed: ${res.status}`);
  return res.json();
}

export async function getOverview(projectId: string): Promise<string | null> {
  const res = await fetch(`/api/projects/${projectId}/overview`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("failed");
  return res.text();
}

export async function patchOverview(projectId: string, markdown: string): Promise<void> {
  const res = await fetch(`/api/projects/${projectId}/overview`, {
    method: "PATCH",
    headers: { "content-type": "text/markdown" },
    body: markdown,
  });
  if (!res.ok) throw new Error("patch failed");
}

export async function approveOverview(projectId: string): Promise<void> {
  const res = await fetch(`/api/projects/${projectId}/overview/approve`, { method: "POST" });
  if (!res.ok) throw new Error("approve failed");
}

export async function listCaseExperts(projectId: string): Promise<CaseExpertInfo[]> {
  const res = await fetch(`/api/projects/${projectId}/experts/case`);
  if (!res.ok) throw new Error("failed");
  return res.json();
}

export async function startCasePlan(projectId: string, experts: string[]): Promise<void> {
  const res = await fetch(`/api/projects/${projectId}/case-plan/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ experts }),
  });
  if (!res.ok) throw new Error("start failed");
}

export async function getCaseCandidates(projectId: string): Promise<string | null> {
  const res = await fetch(`/api/projects/${projectId}/case-plan/candidates`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("failed");
  return res.text();
}

export async function selectCases(projectId: string, indices: number[]): Promise<void> {
  const res = await fetch(`/api/projects/${projectId}/case-plan/select`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ selectedIndices: indices }),
  });
  if (!res.ok) throw new Error("select failed");
}

export async function getSelectedCases(projectId: string): Promise<string | null> {
  const res = await fetch(`/api/projects/${projectId}/case-plan/selected`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("failed");
  return res.text();
}

export const getProject = (id: string) => api.getProject(id);

export const apiMission = {
  start: (projectId: string, experts: string[]) =>
    request<{ ok: true; status: string }>(`/api/projects/${projectId}/mission/start`, {
      method: "POST",
      body: JSON.stringify({ experts }),
    }),
  getCandidates: (projectId: string) =>
    request<string>(`/api/projects/${projectId}/mission/candidates`),
  select: (projectId: string, candidateIndex: number, edits?: string) =>
    request<{ ok: true }>(`/api/projects/${projectId}/mission/select`, {
      method: "POST",
      body: JSON.stringify({ candidateIndex, edits }),
    }),
};

import type { Project, Expert, ProjectImage, OverviewGenerateBody } from "./types";

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
  listProjects: () => request<Project[]>("/api/projects"),
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

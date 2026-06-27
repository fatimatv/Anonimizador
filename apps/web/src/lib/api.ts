export type UserRole = 'admin' | 'operator' | 'reviewer';

export interface CurrentUser {
  email: string;
  id: string;
  isActive: boolean;
  role: UserRole;
}

export interface Job {
  id: string;
  status: string;
  totalFiles: number;
  processedFiles?: number;
  failedFiles?: number;
  riskLevel?: string;
  expiresAt?: string;
}

export interface DetectionSummary {
  entityCounts: Record<string, number>;
  riskLevel: string;
  rulesVersion: string;
  totalEntities: number;
}

export interface DetectionItem {
  category: string;
  confidence: number;
  endOffset: number;
  entityType: string;
  id: string;
  previewMasked: string;
  replacementType: string;
  ruleId: string | null;
  startOffset: number;
}

export interface DocumentItem {
  anonymizedText?: string | null;
  detectionSummary?: DetectionSummary | null;
  detections?: DetectionItem[];
  fileSizeBytes: number;
  id: string;
  mimeType: string;
  status: string;
  validationSummary?: {
    anonymization?: {
      outputMimeType: string;
      replacementsApplied: number;
      rulesVersion?: string;
    };
    extension?: string;
    extraction?: {
      extractedTextHash: string;
      extractedTextLength: number;
    };
  };
}

export interface JobDetail {
  documents: DocumentItem[];
  job: Job;
}

export interface UploadResponse {
  documents: DocumentItem[];
  job: Job;
}

export interface DetectionsResponse {
  detections: DetectionItem[];
  document: {
    detectionSummary: DetectionSummary | null;
    id: string;
    status: string;
  };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

const apiBase = (process.env.NEXT_PUBLIC_API_URL ?? '/backend').replace(/\/$/u, '');

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(!(init.body instanceof FormData) ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    throw await apiErrorFrom(response);
  }

  return (await response.json()) as T;
}

export async function apiDownload(path: string): Promise<Blob> {
  const response = await fetch(`${apiBase}${path}`, {
    credentials: 'include',
  });

  if (!response.ok) {
    throw await apiErrorFrom(response);
  }

  return await response.blob();
}

export async function login(input: { email: string; password: string }) {
  return await apiJson<{ expiresAt: string; user: CurrentUser }>('/auth/login', {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export async function publicLogin() {
  return await apiJson<{ expiresAt: string; user: CurrentUser }>('/auth/public', {
    body: JSON.stringify({}),
    method: 'POST',
  });
}

export async function logout() {
  return await apiJson<{ ok: boolean }>('/auth/logout', {
    method: 'POST',
  });
}

export async function currentSession() {
  return await apiJson<{ user: CurrentUser }>('/auth/me');
}

export async function uploadBatch(files: File[]) {
  const formData = new FormData();

  for (const file of files) {
    formData.append('files', file);
  }

  return await apiJson<UploadResponse>('/uploads/batch', {
    body: formData,
    method: 'POST',
  });
}

export async function getJob(jobId: string) {
  return await apiJson<JobDetail>(`/jobs/${jobId}`);
}

export async function getDetections(documentId: string) {
  return await apiJson<DetectionsResponse>(`/documents/${documentId}/detections`);
}

export async function approveDocument(documentId: string) {
  return await apiJson<{ document: { id: string; status: string } }>(
    `/review/documents/${documentId}/approve`,
    {
      method: 'POST',
    },
  );
}

export async function rejectDocument(documentId: string) {
  return await apiJson<{ document: { id: string; status: string } }>(
    `/review/documents/${documentId}/reject`,
    {
      method: 'POST',
    },
  );
}

export async function downloadAnonymized(documentId: string) {
  return await apiDownload(`/documents/${documentId}/download-anonymized`);
}

export async function deleteJob(jobId: string) {
  return await apiJson<{ deletedDocuments: number; job: { id: string; status: string } }>(
    `/jobs/${jobId}`,
    {
      method: 'DELETE',
    },
  );
}

async function apiErrorFrom(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as { error?: string };

    return new ApiError(response.status, body.error ?? 'request_failed');
  } catch {
    return new ApiError(response.status, 'request_failed');
  }
}

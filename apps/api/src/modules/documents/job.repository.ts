import { randomUUID } from 'node:crypto';
import type {
  AnonymizationSummary,
  DetectionResult,
  EntityCategory,
  EntityType,
  ReplacementType,
  RiskLevel,
} from '@document-anonymizer/rules-engine';

export type JobStatus =
  | 'completed'
  | 'deleted'
  | 'failed'
  | 'needs_review'
  | 'processing'
  | 'queued'
  | 'rejected'
  | 'uploaded'
  | 'approved';

export type DocumentStatus =
  | 'anonymizing'
  | 'approved'
  | 'completed'
  | 'deleted'
  | 'detecting_entities'
  | 'extracting_text'
  | 'failed'
  | 'needs_review'
  | 'rejected'
  | 'uploaded';

export interface JobRecord {
  id: string;
  createdByUserId: string;
  status: JobStatus;
  totalFiles: number;
  processedFiles: number;
  failedFiles: number;
  riskLevel: RiskLevel;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface DetectionSummaryRecord {
  entityCounts: Partial<Record<EntityType, number>>;
  riskLevel: RiskLevel;
  rulesVersion: string;
  totalEntities: number;
}

export interface DocumentRecord {
  id: string;
  jobId: string;
  originalFileNameHash: string;
  originalMimeType: string;
  fileSizeBytes: number;
  status: DocumentStatus;
  originalStorageKey: string;
  anonymizedStorageKey: string | null;
  contentHash: string;
  anonymizedContentHash: string | null;
  detectionSummary: DetectionSummaryRecord | null;
  validationSummary: {
    anonymization?: AnonymizationSummary & {
      anonymizedContentHash: string;
      outputExtension: string;
      outputMimeType: string;
    };
    extension: string;
    extraction?: {
      extractedTextHash: string;
      extractedTextLength: number;
    };
  };
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface DetectedEntityRecord {
  id: string;
  documentId: string;
  entityType: EntityType;
  category: EntityCategory;
  startOffset: number;
  endOffset: number;
  confidence: number;
  replacementType: ReplacementType;
  previewMasked: string;
  rawValueHash: string;
  ruleId: string | null;
  contextWindowHash: string | null;
  createdAt: string;
}

export interface CreateJobInput {
  createdByUserId: string;
  expiresAt: Date;
  totalFiles: number;
}

export interface CreateDocumentInput {
  contentHash: string;
  expiresAt: Date;
  fileSizeBytes: number;
  jobId: string;
  originalFileNameHash: string;
  originalMimeType: string;
  originalStorageKey: string;
  validationSummary: {
    extension: string;
  };
}

export interface JobRepository {
  createDetectedEntities(
    documentId: string,
    detections: readonly DetectionResult[],
  ): Promise<DetectedEntityRecord[]>;
  createJob(input: CreateJobInput): Promise<JobRecord>;
  createDocument(input: CreateDocumentInput): Promise<DocumentRecord>;
  getDetectedEntitiesByDocumentId(documentId: string): Promise<DetectedEntityRecord[]>;
  getDocumentsByJobId(jobId: string): Promise<DocumentRecord[]>;
  getDocumentById(documentId: string): Promise<DocumentRecord | null>;
  getJobById(jobId: string): Promise<JobRecord | null>;
  incrementFailedFiles(jobId: string): Promise<void>;
  incrementProcessedFiles(jobId: string): Promise<void>;
  listExpiredJobs(now: Date): Promise<JobRecord[]>;
  markJobDeleted(jobId: string): Promise<JobRecord | null>;
  updateDocumentStatus(documentId: string, status: DocumentStatus): Promise<DocumentRecord | null>;
  updateDocumentValidationSummary(
    documentId: string,
    validationSummary: DocumentRecord['validationSummary'],
  ): Promise<DocumentRecord | null>;
  updateDocumentDetectionSummary(
    documentId: string,
    detectionSummary: DetectionSummaryRecord,
  ): Promise<DocumentRecord | null>;
  updateDocumentAnonymizedFile(
    documentId: string,
    input: {
      anonymizedContentHash: string;
      anonymizedStorageKey: string;
      anonymizationSummary: AnonymizationSummary & {
        anonymizedContentHash: string;
        outputExtension: string;
        outputMimeType: string;
      };
    },
  ): Promise<DocumentRecord | null>;
  updateJobRiskLevel(jobId: string, riskLevel: RiskLevel): Promise<JobRecord | null>;
  updateJobStatus(jobId: string, status: JobStatus): Promise<JobRecord | null>;
}

export class InMemoryJobRepository implements JobRepository {
  private readonly jobs = new Map<string, JobRecord>();

  private readonly documents = new Map<string, DocumentRecord>();

  private readonly detectedEntities = new Map<string, DetectedEntityRecord[]>();

  async createDetectedEntities(
    documentId: string,
    detections: readonly DetectionResult[],
  ): Promise<DetectedEntityRecord[]> {
    const now = new Date().toISOString();
    const records = detections.map((detection) => ({
      category: detection.category,
      confidence: detection.confidence,
      contextWindowHash: detection.contextWindowHash ?? null,
      createdAt: now,
      documentId,
      endOffset: detection.endOffset,
      entityType: detection.entityType,
      id: randomUUID(),
      previewMasked: detection.previewMasked,
      rawValueHash: detection.rawValueHash,
      replacementType: detection.replacementType,
      ruleId: detection.ruleId ?? null,
      startOffset: detection.startOffset,
    }));

    this.detectedEntities.set(documentId, records);

    return records;
  }

  async createJob(input: CreateJobInput): Promise<JobRecord> {
    const now = new Date().toISOString();
    const job: JobRecord = {
      createdAt: now,
      createdByUserId: input.createdByUserId,
      expiresAt: input.expiresAt.toISOString(),
      failedFiles: 0,
      id: randomUUID(),
      processedFiles: 0,
      riskLevel: 'low',
      status: 'uploaded',
      totalFiles: input.totalFiles,
      updatedAt: now,
    };

    this.jobs.set(job.id, job);

    return job;
  }

  async createDocument(input: CreateDocumentInput): Promise<DocumentRecord> {
    const now = new Date().toISOString();
    const document: DocumentRecord = {
      anonymizedContentHash: null,
      anonymizedStorageKey: null,
      contentHash: input.contentHash,
      createdAt: now,
      detectionSummary: null,
      expiresAt: input.expiresAt.toISOString(),
      fileSizeBytes: input.fileSizeBytes,
      id: randomUUID(),
      jobId: input.jobId,
      originalFileNameHash: input.originalFileNameHash,
      originalMimeType: input.originalMimeType,
      originalStorageKey: input.originalStorageKey,
      status: 'uploaded',
      updatedAt: now,
      validationSummary: input.validationSummary,
    };

    this.documents.set(document.id, document);

    return document;
  }

  async getDetectedEntitiesByDocumentId(documentId: string): Promise<DetectedEntityRecord[]> {
    return this.detectedEntities.get(documentId) ?? [];
  }

  async getDocumentsByJobId(jobId: string): Promise<DocumentRecord[]> {
    return [...this.documents.values()].filter((document) => document.jobId === jobId);
  }

  async getDocumentById(documentId: string): Promise<DocumentRecord | null> {
    return this.documents.get(documentId) ?? null;
  }

  async getJobById(jobId: string): Promise<JobRecord | null> {
    return this.jobs.get(jobId) ?? null;
  }

  async listExpiredJobs(now: Date): Promise<JobRecord[]> {
    return [...this.jobs.values()].filter((job) => {
      return job.status !== 'deleted' && new Date(job.expiresAt).getTime() <= now.getTime();
    });
  }

  async incrementFailedFiles(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);

    if (!job) {
      return;
    }

    job.failedFiles += 1;
    job.updatedAt = new Date().toISOString();

    if (job.failedFiles >= job.totalFiles) {
      job.status = 'failed';
    }
  }

  async incrementProcessedFiles(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);

    if (!job) {
      return;
    }

    job.processedFiles += 1;
    job.updatedAt = new Date().toISOString();
  }

  async markJobDeleted(jobId: string): Promise<JobRecord | null> {
    const job = this.jobs.get(jobId);

    if (!job) {
      return null;
    }

    const now = new Date().toISOString();
    job.status = 'deleted';
    job.updatedAt = now;

    for (const document of this.documents.values()) {
      if (document.jobId === jobId) {
        document.status = 'deleted';
        document.updatedAt = now;
      }
    }

    return job;
  }

  async updateDocumentStatus(
    documentId: string,
    status: DocumentStatus,
  ): Promise<DocumentRecord | null> {
    const document = this.documents.get(documentId);

    if (!document) {
      return null;
    }

    document.status = status;
    document.updatedAt = new Date().toISOString();

    return document;
  }

  async updateDocumentValidationSummary(
    documentId: string,
    validationSummary: DocumentRecord['validationSummary'],
  ): Promise<DocumentRecord | null> {
    const document = this.documents.get(documentId);

    if (!document) {
      return null;
    }

    document.validationSummary = validationSummary;
    document.updatedAt = new Date().toISOString();

    return document;
  }

  async updateDocumentDetectionSummary(
    documentId: string,
    detectionSummary: DetectionSummaryRecord,
  ): Promise<DocumentRecord | null> {
    const document = this.documents.get(documentId);

    if (!document) {
      return null;
    }

    document.detectionSummary = detectionSummary;
    document.updatedAt = new Date().toISOString();

    return document;
  }

  async updateDocumentAnonymizedFile(
    documentId: string,
    input: {
      anonymizedContentHash: string;
      anonymizedStorageKey: string;
      anonymizationSummary: AnonymizationSummary & {
        anonymizedContentHash: string;
        outputExtension: string;
        outputMimeType: string;
      };
    },
  ): Promise<DocumentRecord | null> {
    const document = this.documents.get(documentId);

    if (!document) {
      return null;
    }

    document.anonymizedContentHash = input.anonymizedContentHash;
    document.anonymizedStorageKey = input.anonymizedStorageKey;
    document.validationSummary = {
      ...document.validationSummary,
      anonymization: input.anonymizationSummary,
    };
    document.updatedAt = new Date().toISOString();

    return document;
  }

  async updateJobRiskLevel(jobId: string, riskLevel: RiskLevel): Promise<JobRecord | null> {
    const job = this.jobs.get(jobId);

    if (!job) {
      return null;
    }

    job.riskLevel = riskLevel;
    job.updatedAt = new Date().toISOString();

    return job;
  }

  async updateJobStatus(jobId: string, status: JobStatus): Promise<JobRecord | null> {
    const job = this.jobs.get(jobId);

    if (!job) {
      return null;
    }

    job.status = status;
    job.updatedAt = new Date().toISOString();

    return job;
  }
}

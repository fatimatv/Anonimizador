import type { Prisma, PrismaClient } from '@prisma/client';
import type { DetectionResult } from '@document-anonymizer/rules-engine';
import type {
  CreateDocumentInput,
  CreateJobInput,
  DetectedEntityRecord,
  DetectionSummaryRecord,
  DocumentRecord,
  DocumentStatus,
  JobRecord,
  JobRepository,
  JobStatus,
} from './job.repository.js';

type PrismaJob = Awaited<ReturnType<PrismaClient['job']['findUnique']>>;
type PrismaDocument = Awaited<ReturnType<PrismaClient['document']['findUnique']>>;
type PrismaDetectedEntity = Awaited<ReturnType<PrismaClient['detectedEntity']['findFirst']>>;

export class PrismaJobRepository implements JobRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createDetectedEntities(
    documentId: string,
    detections: readonly DetectionResult[],
  ): Promise<DetectedEntityRecord[]> {
    await this.prisma.detectedEntity.deleteMany({
      where: {
        documentId,
      },
    });

    if (detections.length === 0) {
      return [];
    }

    await this.prisma.detectedEntity.createMany({
      data: detections.map((detection) => ({
        category: detection.category,
        confidence: detection.confidence,
        contextWindowHash: detection.contextWindowHash ?? null,
        documentId,
        endOffset: detection.endOffset,
        entityType: detection.entityType,
        previewMasked: detection.previewMasked,
        rawValueHash: detection.rawValueHash,
        replacementType: detection.replacementType,
        ruleId: detection.ruleId ?? null,
        startOffset: detection.startOffset,
      })),
    });

    return await this.getDetectedEntitiesByDocumentId(documentId);
  }

  async createJob(input: CreateJobInput): Promise<JobRecord> {
    const job = await this.prisma.job.create({
      data: {
        createdByUserId: input.createdByUserId,
        expiresAt: input.expiresAt,
        status: 'uploaded',
        totalFiles: input.totalFiles,
      },
    });

    return toJobRecord(job);
  }

  async createDocument(input: CreateDocumentInput): Promise<DocumentRecord> {
    const document = await this.prisma.document.create({
      data: {
        contentHash: input.contentHash,
        expiresAt: input.expiresAt,
        fileSizeBytes: input.fileSizeBytes,
        jobId: input.jobId,
        originalFileNameHash: input.originalFileNameHash,
        originalMimeType: input.originalMimeType,
        originalStorageKey: input.originalStorageKey,
        status: 'uploaded',
        validationSummary: toJson(input.validationSummary),
      },
    });

    return toDocumentRecord(document);
  }

  async getDetectedEntitiesByDocumentId(documentId: string): Promise<DetectedEntityRecord[]> {
    const detections = await this.prisma.detectedEntity.findMany({
      orderBy: {
        startOffset: 'asc',
      },
      where: {
        documentId,
      },
    });

    return detections.map(toDetectedEntityRecord);
  }

  async getDocumentsByJobId(jobId: string): Promise<DocumentRecord[]> {
    const documents = await this.prisma.document.findMany({
      orderBy: {
        createdAt: 'asc',
      },
      where: {
        jobId,
      },
    });

    return documents.map(toDocumentRecord);
  }

  async getDocumentById(documentId: string): Promise<DocumentRecord | null> {
    const document = await this.prisma.document.findUnique({
      where: {
        id: documentId,
      },
    });

    return document ? toDocumentRecord(document) : null;
  }

  async getJobById(jobId: string): Promise<JobRecord | null> {
    const job = await this.prisma.job.findUnique({
      where: {
        id: jobId,
      },
    });

    return job ? toJobRecord(job) : null;
  }

  async incrementFailedFiles(jobId: string): Promise<void> {
    const job = await this.prisma.job.update({
      data: {
        failedFiles: {
          increment: 1,
        },
      },
      where: {
        id: jobId,
      },
    });

    if (job.failedFiles >= job.totalFiles) {
      await this.updateJobStatus(jobId, 'failed');
    }
  }

  async incrementProcessedFiles(jobId: string): Promise<void> {
    await this.prisma.job.update({
      data: {
        processedFiles: {
          increment: 1,
        },
      },
      where: {
        id: jobId,
      },
    });
  }

  async listExpiredJobs(now: Date): Promise<JobRecord[]> {
    const jobs = await this.prisma.job.findMany({
      where: {
        expiresAt: {
          lte: now,
        },
        status: {
          not: 'deleted',
        },
      },
    });

    return jobs.map(toJobRecord);
  }

  async markJobDeleted(jobId: string): Promise<JobRecord | null> {
    try {
      const job = await this.prisma.job.update({
        data: {
          documents: {
            updateMany: {
              data: {
                status: 'deleted',
              },
              where: {},
            },
          },
          status: 'deleted',
        },
        where: {
          id: jobId,
        },
      });

      return toJobRecord(job);
    } catch {
      return null;
    }
  }

  async updateDocumentStatus(
    documentId: string,
    status: DocumentStatus,
  ): Promise<DocumentRecord | null> {
    return await this.updateDocument(documentId, {
      status,
    });
  }

  async updateDocumentValidationSummary(
    documentId: string,
    validationSummary: DocumentRecord['validationSummary'],
  ): Promise<DocumentRecord | null> {
    return await this.updateDocument(documentId, {
      validationSummary: toJson(validationSummary),
    });
  }

  async updateDocumentDetectionSummary(
    documentId: string,
    detectionSummary: DetectionSummaryRecord,
  ): Promise<DocumentRecord | null> {
    return await this.updateDocument(documentId, {
      detectionSummary: toJson(detectionSummary),
    });
  }

  async updateDocumentAnonymizedFile(
    documentId: string,
    input: {
      anonymizedContentHash: string;
      anonymizedStorageKey: string;
      anonymizationSummary: NonNullable<DocumentRecord['validationSummary']['anonymization']>;
    },
  ): Promise<DocumentRecord | null> {
    const existing = await this.getDocumentById(documentId);

    if (!existing) {
      return null;
    }

    return await this.updateDocument(documentId, {
      anonymizedContentHash: input.anonymizedContentHash,
      anonymizedStorageKey: input.anonymizedStorageKey,
      validationSummary: toJson({
        ...existing.validationSummary,
        anonymization: input.anonymizationSummary,
      }),
    });
  }

  async updateJobRiskLevel(
    jobId: string,
    riskLevel: JobRecord['riskLevel'],
  ): Promise<JobRecord | null> {
    return await this.updateJob(jobId, {
      riskLevel,
    });
  }

  async updateJobStatus(jobId: string, status: JobStatus): Promise<JobRecord | null> {
    return await this.updateJob(jobId, {
      status,
    });
  }

  private async updateDocument(
    documentId: string,
    data: Prisma.DocumentUpdateInput,
  ): Promise<DocumentRecord | null> {
    try {
      const document = await this.prisma.document.update({
        data,
        where: {
          id: documentId,
        },
      });

      return toDocumentRecord(document);
    } catch {
      return null;
    }
  }

  private async updateJob(jobId: string, data: Prisma.JobUpdateInput): Promise<JobRecord | null> {
    try {
      const job = await this.prisma.job.update({
        data,
        where: {
          id: jobId,
        },
      });

      return toJobRecord(job);
    } catch {
      return null;
    }
  }
}

function toJobRecord(job: NonNullable<PrismaJob>): JobRecord {
  return {
    createdAt: job.createdAt.toISOString(),
    createdByUserId: job.createdByUserId,
    expiresAt: (job.expiresAt ?? job.createdAt).toISOString(),
    failedFiles: job.failedFiles,
    id: job.id,
    processedFiles: job.processedFiles,
    riskLevel: job.riskLevel,
    status: job.status,
    totalFiles: job.totalFiles,
    updatedAt: job.updatedAt.toISOString(),
  };
}

function toDocumentRecord(document: NonNullable<PrismaDocument>): DocumentRecord {
  return {
    anonymizedContentHash: document.anonymizedContentHash,
    anonymizedStorageKey: document.anonymizedStorageKey,
    contentHash: document.contentHash ?? '',
    createdAt: document.createdAt.toISOString(),
    detectionSummary: document.detectionSummary as unknown as DetectionSummaryRecord | null,
    expiresAt: (document.expiresAt ?? document.createdAt).toISOString(),
    fileSizeBytes: document.fileSizeBytes,
    id: document.id,
    jobId: document.jobId,
    originalFileNameHash: document.originalFileNameHash,
    originalMimeType: document.originalMimeType,
    originalStorageKey: document.originalStorageKey ?? '',
    status: document.status,
    updatedAt: document.updatedAt.toISOString(),
    validationSummary: document.validationSummary as unknown as DocumentRecord['validationSummary'],
  };
}

function toDetectedEntityRecord(entity: NonNullable<PrismaDetectedEntity>): DetectedEntityRecord {
  return {
    category: entity.category,
    confidence: entity.confidence,
    contextWindowHash: entity.contextWindowHash,
    createdAt: entity.createdAt.toISOString(),
    documentId: entity.documentId,
    endOffset: entity.endOffset ?? 0,
    entityType: entity.entityType,
    id: entity.id,
    previewMasked: entity.previewMasked,
    rawValueHash: entity.rawValueHash,
    replacementType: entity.replacementType,
    ruleId: entity.ruleId,
    startOffset: entity.startOffset ?? 0,
  };
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

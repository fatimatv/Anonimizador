import { createHash } from 'node:crypto';
import type { AuditService } from '../audit/audit.service.js';
import type { AnonymizationService } from '../anonymization/anonymization.service.js';
import type { JobRepository } from '../documents/job.repository.js';
import type { DetectionService } from '../detection/detection.service.js';
import type { StorageService } from '../storage/storage.service.js';
import type { TextExtractionService } from './text-extraction.service.js';

type ProcessingRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export class ProcessingService {
  constructor(
    private readonly options: {
      auditService: AuditService;
      anonymizationService: AnonymizationService;
      detectionService: DetectionService;
      jobRepository: JobRepository;
      storageService: StorageService;
      textExtractionService: TextExtractionService;
    },
  ) {}

  async processDocument(documentId: string): Promise<void> {
    const document = await this.options.jobRepository.getDocumentById(documentId);

    if (!document) {
      return;
    }

    await this.options.jobRepository.updateJobStatus(document.jobId, 'processing');
    await this.options.jobRepository.updateDocumentStatus(document.id, 'extracting_text');
    this.options.auditService.record({
      actorUserId: null,
      action: 'processing_started',
      resourceId: document.id,
      resourceType: 'document',
      result: 'success',
      metadata: {
        jobId: document.jobId,
        mimeType: document.originalMimeType,
      },
    });
    let failureReason = 'local_processing_failed';

    try {
      failureReason = 'local_text_extraction_failed';
      const originalBuffer = await this.options.storageService.read(document.originalStorageKey);
      const extraction = await this.options.textExtractionService.extract({
        buffer: originalBuffer,
        mimeType: document.originalMimeType,
      });
      const extractionSummary = {
        extractedTextHash: extraction.extractedTextHash,
        extractedTextLength: extraction.extractedTextLength,
      };

      await this.options.jobRepository.updateDocumentValidationSummary(document.id, {
        ...document.validationSummary,
        extraction: extractionSummary,
      });
      await this.options.jobRepository.updateDocumentStatus(document.id, 'detecting_entities');
      failureReason = 'local_detection_failed';
      const detectionResult = this.options.detectionService.detect(extraction.text);
      await this.options.jobRepository.createDetectedEntities(
        document.id,
        detectionResult.detections,
      );
      await this.options.jobRepository.updateDocumentDetectionSummary(document.id, {
        ...detectionResult.summary,
        rulesVersion: detectionResult.rulesVersion,
      });
      await this.options.jobRepository.updateJobRiskLevel(
        document.jobId,
        await this.resolveJobRiskLevel(document.jobId, detectionResult.summary.riskLevel),
      );
      this.options.auditService.record({
        actorUserId: null,
        action: 'detection_completed',
        resourceId: document.id,
        resourceType: 'document',
        result: 'success',
        metadata: {
          entityCounts: safeEntityCounts(detectionResult.summary.entityCounts),
          jobId: document.jobId,
          riskLevel: detectionResult.summary.riskLevel,
          rulesVersion: detectionResult.rulesVersion,
          totalEntities: detectionResult.summary.totalEntities,
        },
      });
      failureReason = 'local_anonymization_failed';
      await this.options.jobRepository.updateDocumentStatus(document.id, 'anonymizing');
      const anonymizationResult = this.options.anonymizationService.anonymize({
        detections: detectionResult.detections,
        text: extraction.text,
      });
      const anonymizedBuffer = Buffer.from(anonymizationResult.anonymizedText, 'utf8');
      const anonymizedContentHash = hashBuffer(anonymizedBuffer);
      const anonymizedFile = await this.options.storageService.saveAnonymized({
        buffer: anonymizedBuffer,
        extension: '.txt',
        originalStorageKey: document.originalStorageKey,
      });

      await this.options.jobRepository.updateDocumentAnonymizedFile(document.id, {
        anonymizationSummary: {
          ...anonymizationResult.summary,
          anonymizedContentHash,
          outputExtension: '.txt',
          outputMimeType: 'text/plain',
        },
        anonymizedContentHash,
        anonymizedStorageKey: anonymizedFile.storageKey,
      });
      await this.options.jobRepository.updateDocumentStatus(document.id, 'needs_review');
      this.options.auditService.record({
        actorUserId: null,
        action: 'anonymization_completed',
        resourceId: document.id,
        resourceType: 'document',
        result: 'success',
        metadata: {
          anonymizedHash: anonymizedContentHash,
          jobId: document.jobId,
          outputMimeType: 'text/plain',
          replacementsApplied: anonymizationResult.summary.replacementsApplied,
          rulesVersion: anonymizationResult.summary.rulesVersion,
        },
      });
      await this.options.jobRepository.incrementProcessedFiles(document.jobId);
      await this.finalizeJobIfReady(document.jobId);
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      const errorMessage = error instanceof Error ? error.message.slice(0, 160) : undefined;

      console.error('local_processing_failed', {
        errorMessage,
        errorName,
        reason: failureReason,
      });
      await this.options.jobRepository.updateDocumentStatus(document.id, 'failed');
      await this.options.jobRepository.incrementFailedFiles(document.jobId);
      await this.finalizeJobIfReady(document.jobId);
      this.options.auditService.record({
        actorUserId: null,
        action: 'security_event',
        resourceId: document.id,
        resourceType: 'document',
        result: 'failure',
        metadata: {
          jobId: document.jobId,
          reason: failureReason,
        },
      });
    }
  }

  private async resolveJobRiskLevel(
    jobId: string,
    currentRiskLevel: ProcessingRiskLevel,
  ): Promise<ProcessingRiskLevel> {
    const rank: Record<ProcessingRiskLevel, number> = {
      critical: 4,
      high: 3,
      low: 1,
      medium: 2,
    };
    const documents = await this.options.jobRepository.getDocumentsByJobId(jobId);

    return documents.reduce((highestRiskLevel, document) => {
      const documentRiskLevel = document.detectionSummary?.riskLevel;

      if (!documentRiskLevel) {
        return highestRiskLevel;
      }

      return rank[documentRiskLevel] > rank[highestRiskLevel]
        ? documentRiskLevel
        : highestRiskLevel;
    }, currentRiskLevel);
  }

  private async finalizeJobIfReady(jobId: string): Promise<void> {
    const job = await this.options.jobRepository.getJobById(jobId);

    if (!job || job.processedFiles + job.failedFiles < job.totalFiles) {
      return;
    }

    if (job.processedFiles > 0) {
      await this.options.jobRepository.updateJobStatus(jobId, 'needs_review');
    }
  }
}

function safeEntityCounts(entityCounts: Partial<Record<string, number>>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(entityCounts).filter((entry): entry is [string, number] => {
      const [, count] = entry;

      return typeof count === 'number';
    }),
  );
}

function hashBuffer(buffer: Buffer): string {
  return `sha256:${createHash('sha256').update(buffer).digest('hex')}`;
}

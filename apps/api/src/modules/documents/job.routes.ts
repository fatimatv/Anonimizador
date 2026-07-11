import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  OutputRendererService,
  type AnonymizedOutputFormat,
} from '../anonymization/output-renderer.service.js';
import { canAccessRole, type AuthenticatedUser } from '../../common/guards/roles.js';
import type { AuditService } from '../audit/audit.service.js';
import type { DeletionService } from '../deletion/deletion.service.js';
import type { StorageService } from '../storage/storage.service.js';
import type { DetectedEntityRecord, JobRepository, JobRecord } from './job.repository.js';

interface JobRoutesOptions {
  auditService: AuditService;
  deletionService: DeletionService;
  getCurrentUser: (request: FastifyRequest) => Promise<AuthenticatedUser | null>;
  jobRepository: JobRepository;
  outputRendererService?: OutputRendererService;
  storageService: StorageService;
}

export async function registerJobRoutes(
  app: FastifyInstance,
  options: JobRoutesOptions,
): Promise<void> {
  app.get('/jobs/:jobId', async (request, reply) => {
    const currentUser = await options.getCurrentUser(request);

    if (!currentUser) {
      return reply.code(401).send({ error: 'authentication_required' });
    }

    const { jobId } = request.params as { jobId: string };
    const job = await options.jobRepository.getJobById(jobId);

    if (!job) {
      return reply.code(404).send({ error: 'job_not_found' });
    }

    if (!canReadJob(currentUser, job)) {
      return reply.code(403).send({ error: 'insufficient_role' });
    }

    const documents = await options.jobRepository.getDocumentsByJobId(job.id);

    return {
      documents: documents.map((document) => ({
        fileSizeBytes: document.fileSizeBytes,
        id: document.id,
        mimeType: document.originalMimeType,
        status: document.status,
        detectionSummary: document.detectionSummary,
        validationSummary: document.validationSummary,
      })),
      job,
    };
  });

  app.delete('/jobs/:jobId', async (request, reply) => {
    const currentUser = await options.getCurrentUser(request);

    if (!currentUser) {
      return reply.code(401).send({ error: 'authentication_required' });
    }

    const { jobId } = request.params as { jobId: string };
    const job = await options.jobRepository.getJobById(jobId);

    if (!job) {
      return reply.code(404).send({ error: 'job_not_found' });
    }

    if (!canDeleteJob(currentUser, job)) {
      return reply.code(403).send({ error: 'insufficient_role' });
    }

    options.auditService.record({
      actorUserId: currentUser.id,
      action: 'deletion_requested',
      resourceId: job.id,
      resourceType: 'job',
      result: 'success',
      metadata: {
        jobId: job.id,
        reason: 'manual',
      },
    });
    const result = await options.deletionService.deleteJob({
      actorUserId: currentUser.id,
      jobId: job.id,
      reason: 'manual',
    });

    return {
      deletedDocuments: result.deletedDocuments,
      job: {
        id: job.id,
        status: 'deleted',
      },
    };
  });

  app.get('/documents/:documentId/download-anonymized', async (request, reply) => {
    const currentUser = await options.getCurrentUser(request);

    if (!currentUser) {
      return reply.code(401).send({ error: 'authentication_required' });
    }

    const documentContext = await getDocumentContext(request, options);

    if ('error' in documentContext) {
      return reply.code(documentContext.statusCode ?? 404).send({ error: documentContext.error });
    }

    const { document, job } = documentContext;

    if (!canReadJob(currentUser, job)) {
      return reply.code(403).send({ error: 'insufficient_role' });
    }

    if (document.status !== 'approved' && document.status !== 'completed') {
      return reply.code(409).send({ error: 'document_not_approved' });
    }

    if (!document.anonymizedStorageKey) {
      return reply.code(409).send({ error: 'anonymized_file_not_ready' });
    }

    const anonymizedFile = await options.storageService.read(document.anonymizedStorageKey);
    const format = resolveDownloadFormat(request);
    const renderer = options.outputRendererService ?? new OutputRendererService();
    const detections =
      format === 'pdf' && document.originalMimeType === 'application/pdf'
        ? await options.jobRepository.getDetectedEntitiesByDocumentId(document.id)
        : [];
    const originalPdfBuffer =
      format === 'pdf' && document.originalMimeType === 'application/pdf'
        ? await options.storageService.read(document.originalStorageKey)
        : undefined;
    const renderInput = {
      format,
      redactions: detections.map((detection) => ({
        endOffset: detection.endOffset,
        startOffset: detection.startOffset,
      })),
      text: anonymizedFile.toString('utf8'),
    };
    const renderedOutput = await renderer.render(
      originalPdfBuffer
        ? {
            ...renderInput,
            originalPdfBuffer,
          }
        : renderInput,
    );

    options.auditService.record({
      actorUserId: currentUser.id,
      action: 'download_anonymized',
      resourceId: document.id,
      resourceType: 'document',
      result: 'success',
      metadata: {
        documentId: document.id,
        format,
        jobId: job.id,
      },
    });

    return reply
      .header('content-type', renderedOutput.mimeType)
      .header(
        'content-disposition',
        `attachment; filename="anonymized-${document.id}${renderedOutput.extension}"`,
      )
      .send(renderedOutput.buffer);
  });

  app.post('/documents/render-anonymized', async (request, reply) => {
    const currentUser = await options.getCurrentUser(request);

    if (!currentUser) {
      return reply.code(401).send({ error: 'authentication_required' });
    }

    const body = await readStatelessRenderInput(request);
    const text = body.text.replace(/\r\n/gu, '\n').trim();
    const format = resolveBodyDownloadFormat(body.format);

    if (text.length === 0 || text.length > 2_000_000) {
      return reply.code(400).send({ error: 'invalid_payload' });
    }

    const renderer = options.outputRendererService ?? new OutputRendererService();
    const renderedOutput = await renderer.render(
      body.originalPdfBuffer && format === 'pdf'
        ? {
            format,
            originalPdfBuffer: body.originalPdfBuffer,
            redactions: body.redactions,
            text,
          }
        : {
            format,
            text,
          },
    );

    options.auditService.record({
      actorUserId: currentUser.id,
      action: 'download_anonymized',
      resourceType: 'document',
      result: 'success',
      metadata: {
        anonymizedHash: hashBuffer(Buffer.from(text, 'utf8')),
        format,
        mode: 'stateless',
      },
    });

    return reply
      .header('content-type', renderedOutput.mimeType)
      .header('content-disposition', `attachment; filename="anonymized${renderedOutput.extension}"`)
      .send(renderedOutput.buffer);
  });

  app.get('/documents/:documentId/detections', async (request, reply) => {
    const currentUser = await options.getCurrentUser(request);

    if (!currentUser) {
      return reply.code(401).send({ error: 'authentication_required' });
    }

    const { documentId } = request.params as { documentId: string };
    const document = await options.jobRepository.getDocumentById(documentId);

    if (!document) {
      return reply.code(404).send({ error: 'document_not_found' });
    }

    const job = await options.jobRepository.getJobById(document.jobId);

    if (!job) {
      return reply.code(404).send({ error: 'job_not_found' });
    }

    if (!canReadJob(currentUser, job)) {
      return reply.code(403).send({ error: 'insufficient_role' });
    }

    const detections = await options.jobRepository.getDetectedEntitiesByDocumentId(document.id);

    return {
      detections: detections.map(toMaskedDetection),
      document: {
        detectionSummary: document.detectionSummary,
        id: document.id,
        status: document.status,
      },
    };
  });

  app.get('/review/documents/:documentId/anonymized-preview', async (request, reply) => {
    const currentUser = await options.getCurrentUser(request);

    if (!currentUser) {
      return reply.code(401).send({ error: 'authentication_required' });
    }

    const documentContext = await getDocumentContext(request, options);

    if ('error' in documentContext) {
      return reply.code(documentContext.statusCode ?? 404).send({ error: documentContext.error });
    }

    const { document, job } = documentContext;

    if (!canReviewJob(currentUser, job)) {
      recordReviewBlocked(currentUser, options);

      return reply.code(403).send({ error: 'insufficient_role' });
    }

    if (!document.anonymizedStorageKey) {
      return reply.code(409).send({ error: 'anonymized_file_not_ready' });
    }

    if (!['approved', 'completed', 'needs_review'].includes(document.status)) {
      return reply.code(409).send({ error: 'document_not_ready_for_review' });
    }

    const anonymizedFile = await options.storageService.read(document.anonymizedStorageKey);

    return {
      document: {
        id: document.id,
        jobId: job.id,
        status: document.status,
      },
      text: anonymizedFile.toString('utf8'),
    };
  });

  app.patch('/review/documents/:documentId/anonymized-preview', async (request, reply) => {
    const currentUser = await options.getCurrentUser(request);

    if (!currentUser) {
      return reply.code(401).send({ error: 'authentication_required' });
    }

    const documentContext = await getDocumentContext(request, options);

    if ('error' in documentContext) {
      return reply.code(documentContext.statusCode ?? 404).send({ error: documentContext.error });
    }

    const { document, job } = documentContext;

    if (!canReviewJob(currentUser, job)) {
      recordReviewBlocked(currentUser, options);

      return reply.code(403).send({ error: 'insufficient_role' });
    }

    const body = request.body as { text?: unknown };

    if (typeof body.text !== 'string' || body.text.trim().length === 0) {
      return reply.code(400).send({ error: 'invalid_payload' });
    }

    if (!document.anonymizedStorageKey) {
      return reply.code(409).send({ error: 'anonymized_file_not_ready' });
    }

    if (!['approved', 'completed', 'needs_review'].includes(document.status)) {
      return reply.code(409).send({ error: 'document_not_ready_for_review' });
    }

    const normalizedText = body.text.replace(/\r\n/gu, '\n').trim();
    const anonymizedBuffer = Buffer.from(normalizedText, 'utf8');
    const anonymizedContentHash = hashBuffer(anonymizedBuffer);
    const anonymizedFile = await options.storageService.saveAnonymized({
      buffer: anonymizedBuffer,
      extension: '.txt',
      originalStorageKey: document.originalStorageKey,
    });
    const existingSummary = document.validationSummary.anonymization;

    await options.jobRepository.updateDocumentAnonymizedFile(document.id, {
      anonymizationSummary: {
        anonymizedContentHash,
        anonymizedTextLength: normalizedText.length,
        manualEditsApplied: true,
        originalTextLength: existingSummary?.originalTextLength ?? normalizedText.length,
        outputExtension: '.txt',
        outputMimeType: 'text/plain',
        replacementsApplied: existingSummary?.replacementsApplied ?? 0,
        replacementsByType: existingSummary?.replacementsByType ?? {},
        rulesVersion: existingSummary?.rulesVersion ?? 'manual-review',
      },
      anonymizedContentHash,
      anonymizedStorageKey: anonymizedFile.storageKey,
    });

    options.auditService.record({
      actorUserId: currentUser.id,
      action: 'review_edited',
      resourceId: document.id,
      resourceType: 'document',
      result: 'success',
      metadata: {
        anonymizedHash: anonymizedContentHash,
        documentId: document.id,
        jobId: job.id,
      },
    });

    return {
      document: {
        id: document.id,
        jobId: job.id,
        status: document.status,
      },
      text: normalizedText,
    };
  });

  app.post('/review/documents/:documentId/approve', async (request, reply) => {
    const currentUser = await options.getCurrentUser(request);

    if (!currentUser) {
      return reply.code(401).send({ error: 'authentication_required' });
    }

    const documentContext = await getDocumentContext(request, options);

    if ('error' in documentContext) {
      return reply.code(documentContext.statusCode ?? 404).send({ error: documentContext.error });
    }

    const { document, job } = documentContext;

    if (!canReviewJob(currentUser, job)) {
      recordReviewBlocked(currentUser, options);

      return reply.code(403).send({ error: 'insufficient_role' });
    }

    if (!document.anonymizedStorageKey) {
      return reply.code(409).send({ error: 'anonymized_file_not_ready' });
    }

    const updatedDocument = await options.jobRepository.updateDocumentStatus(
      document.id,
      'approved',
    );
    await updateReviewJobStatus(job.id, options);
    options.auditService.record({
      actorUserId: currentUser.id,
      action: 'review_approved',
      resourceId: document.id,
      resourceType: 'document',
      result: 'success',
      metadata: {
        documentId: document.id,
        jobId: job.id,
      },
    });

    return {
      document: {
        id: updatedDocument?.id ?? document.id,
        status: updatedDocument?.status ?? 'approved',
      },
    };
  });

  app.post('/review/documents/:documentId/reject', async (request, reply) => {
    const currentUser = await options.getCurrentUser(request);

    if (!currentUser) {
      return reply.code(401).send({ error: 'authentication_required' });
    }

    const documentContext = await getDocumentContext(request, options);

    if ('error' in documentContext) {
      return reply.code(documentContext.statusCode ?? 404).send({ error: documentContext.error });
    }

    const { document, job } = documentContext;

    if (!canReviewJob(currentUser, job)) {
      recordReviewBlocked(currentUser, options);

      return reply.code(403).send({ error: 'insufficient_role' });
    }

    const updatedDocument = await options.jobRepository.updateDocumentStatus(
      document.id,
      'rejected',
    );

    await options.jobRepository.updateJobStatus(job.id, 'rejected');
    options.auditService.record({
      actorUserId: currentUser.id,
      action: 'review_rejected',
      resourceId: document.id,
      resourceType: 'document',
      result: 'success',
      metadata: {
        documentId: document.id,
        jobId: job.id,
      },
    });

    return {
      document: {
        id: updatedDocument?.id ?? document.id,
        status: updatedDocument?.status ?? 'rejected',
      },
    };
  });
}

interface StatelessRenderInput {
  format: unknown;
  originalPdfBuffer?: Buffer;
  redactions: Array<{ endOffset: number; startOffset: number }>;
  text: string;
}

async function readStatelessRenderInput(request: FastifyRequest): Promise<StatelessRenderInput> {
  if (request.isMultipart()) {
    const input: StatelessRenderInput = {
      format: 'txt',
      redactions: [],
      text: '',
    };

    for await (const part of request.parts()) {
      if (part.type === 'file') {
        if (part.fieldname === 'originalPdf') {
          input.originalPdfBuffer = await part.toBuffer();
        }

        continue;
      }

      if (part.fieldname === 'format') {
        input.format = part.value;
        continue;
      }

      if (part.fieldname === 'text') {
        input.text = typeof part.value === 'string' ? part.value : '';
        continue;
      }

      if (part.fieldname === 'redactions' && typeof part.value === 'string') {
        input.redactions = parseRedactions(part.value);
      }
    }

    return input;
  }

  const body = request.body as { format?: unknown; redactions?: unknown; text?: unknown };

  return {
    format: body.format,
    redactions: parseRedactions(body.redactions),
    text: typeof body.text === 'string' ? body.text : '',
  };
}

function parseRedactions(value: unknown): Array<{ endOffset: number; startOffset: number }> {
  const parsed = typeof value === 'string' ? safeJsonParse(value) : value;

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .map((candidate) => {
      if (
        typeof candidate === 'object' &&
        candidate !== null &&
        Number.isInteger((candidate as { startOffset?: unknown }).startOffset) &&
        Number.isInteger((candidate as { endOffset?: unknown }).endOffset)
      ) {
        return {
          endOffset: (candidate as { endOffset: number }).endOffset,
          startOffset: (candidate as { startOffset: number }).startOffset,
        };
      }

      return null;
    })
    .filter((candidate): candidate is { endOffset: number; startOffset: number } => {
      return (
        candidate !== null &&
        candidate.startOffset >= 0 &&
        candidate.endOffset > candidate.startOffset
      );
    });
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function resolveDownloadFormat(request: FastifyRequest): AnonymizedOutputFormat {
  const query = request.query as { format?: string };
  const format = query.format?.toLowerCase();

  if (format === 'docx' || format === 'pdf' || format === 'txt') {
    return format;
  }

  return 'txt';
}

function resolveBodyDownloadFormat(format: unknown): AnonymizedOutputFormat {
  return format === 'docx' || format === 'pdf' || format === 'txt' ? format : 'txt';
}

function canReadJob(currentUser: AuthenticatedUser, job: JobRecord): boolean {
  return (
    currentUser.id === job.createdByUserId || canAccessRole(currentUser, ['admin', 'reviewer'])
  );
}

function canDeleteJob(currentUser: AuthenticatedUser, job: JobRecord): boolean {
  return currentUser.id === job.createdByUserId || canAccessRole(currentUser, ['admin']);
}

function canReviewJob(currentUser: AuthenticatedUser, job: JobRecord): boolean {
  return (
    currentUser.id === job.createdByUserId || canAccessRole(currentUser, ['admin', 'reviewer'])
  );
}

function toMaskedDetection(detection: DetectedEntityRecord) {
  return {
    category: detection.category,
    confidence: detection.confidence,
    endOffset: detection.endOffset,
    entityType: detection.entityType,
    id: detection.id,
    previewMasked: detection.previewMasked,
    replacementType: detection.replacementType,
    ruleId: detection.ruleId,
    startOffset: detection.startOffset,
  };
}

async function getDocumentContext(request: FastifyRequest, options: JobRoutesOptions) {
  const { documentId } = request.params as { documentId: string };
  const document = await options.jobRepository.getDocumentById(documentId);

  if (!document) {
    return {
      error: 'document_not_found',
      statusCode: 404,
    } as const;
  }

  const job = await options.jobRepository.getJobById(document.jobId);

  if (!job) {
    return {
      error: 'job_not_found',
      statusCode: 404,
    } as const;
  }

  return {
    document,
    job,
  };
}

async function updateReviewJobStatus(jobId: string, options: JobRoutesOptions): Promise<void> {
  const documents = await options.jobRepository.getDocumentsByJobId(jobId);

  if (documents.some((document) => document.status === 'rejected')) {
    await options.jobRepository.updateJobStatus(jobId, 'rejected');
    return;
  }

  if (
    documents.length > 0 &&
    documents.every((document) => document.status === 'approved' || document.status === 'completed')
  ) {
    await options.jobRepository.updateJobStatus(jobId, 'approved');
  }
}

function recordReviewBlocked(currentUser: AuthenticatedUser, options: JobRoutesOptions): void {
  options.auditService.record({
    actorUserId: currentUser.id,
    action: 'security_event',
    resourceType: 'review',
    result: 'blocked',
    metadata: {
      actorRole: currentUser.role,
      reason: 'insufficient_role',
      requiredRole: 'admin_or_reviewer',
    },
  });
}

function hashBuffer(buffer: Buffer): string {
  return `sha256:${createHash('sha256').update(buffer).digest('hex')}`;
}

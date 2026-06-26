import type { FastifyInstance, FastifyRequest } from 'fastify';
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

    options.auditService.record({
      actorUserId: currentUser.id,
      action: 'download_anonymized',
      resourceId: document.id,
      resourceType: 'document',
      result: 'success',
      metadata: {
        documentId: document.id,
        jobId: job.id,
      },
    });

    return reply
      .header('content-type', 'text/plain; charset=utf-8')
      .header('content-disposition', `attachment; filename="anonymized-${document.id}.txt"`)
      .send(anonymizedFile);
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

  app.post('/review/documents/:documentId/approve', async (request, reply) => {
    const currentUser = await options.getCurrentUser(request);

    if (!currentUser) {
      return reply.code(401).send({ error: 'authentication_required' });
    }

    if (!canAccessRole(currentUser, ['admin', 'reviewer'])) {
      recordReviewBlocked(currentUser, options);

      return reply.code(403).send({ error: 'insufficient_role' });
    }

    const documentContext = await getDocumentContext(request, options);

    if ('error' in documentContext) {
      return reply.code(documentContext.statusCode ?? 404).send({ error: documentContext.error });
    }

    const { document, job } = documentContext;

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

    if (!canAccessRole(currentUser, ['admin', 'reviewer'])) {
      recordReviewBlocked(currentUser, options);

      return reply.code(403).send({ error: 'insufficient_role' });
    }

    const documentContext = await getDocumentContext(request, options);

    if ('error' in documentContext) {
      return reply.code(documentContext.statusCode ?? 404).send({ error: documentContext.error });
    }

    const { document, job } = documentContext;
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

function canReadJob(currentUser: AuthenticatedUser, job: JobRecord): boolean {
  return (
    currentUser.id === job.createdByUserId || canAccessRole(currentUser, ['admin', 'reviewer'])
  );
}

function canDeleteJob(currentUser: AuthenticatedUser, job: JobRecord): boolean {
  return currentUser.id === job.createdByUserId || canAccessRole(currentUser, ['admin']);
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

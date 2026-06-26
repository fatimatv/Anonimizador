import type { FastifyInstance, FastifyRequest } from 'fastify';
import { firstHeaderValue } from '../../common/utils/headers.js';
import { canAccessRole, type AuthenticatedUser } from '../../common/guards/roles.js';
import type { JobRepository } from '../documents/job.repository.js';
import type { AuditService } from '../audit/audit.service.js';
import type { ProcessingQueue } from '../processing/processing.queue.js';
import type { StorageService } from '../storage/storage.service.js';
import {
  FileValidationService,
  type IncomingUploadFile,
  type UploadValidationError,
} from './file-validation.service.js';
import type { UploadLimits } from './upload.config.js';

interface UploadRoutesOptions {
  auditService: AuditService;
  fileValidationService: FileValidationService;
  getCurrentUser: (request: FastifyRequest) => Promise<AuthenticatedUser | null>;
  jobRepository: JobRepository;
  processingQueue: ProcessingQueue;
  storageService: StorageService;
  ttlMinutes: number;
  uploadLimits: UploadLimits;
}

export async function registerUploadRoutes(
  app: FastifyInstance,
  options: UploadRoutesOptions,
): Promise<void> {
  app.get('/uploads/limits', async (request, reply) => {
    const currentUser = await options.getCurrentUser(request);

    if (!currentUser) {
      return reply.code(401).send({ error: 'authentication_required' });
    }

    return {
      maxBatchFiles: options.uploadLimits.maxBatchFiles,
      maxFileSizeBytes: options.uploadLimits.maxFileSizeBytes,
      maxFileSizeMb: options.uploadLimits.maxFileSizeMb,
      supportedExtensions: ['.txt', '.pdf', '.docx'],
      supportedMimeTypes: [
        'text/plain',
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ],
    };
  });

  app.post('/uploads/batch', async (request, reply) => {
    const currentUser = await options.getCurrentUser(request);

    if (!currentUser) {
      return reply.code(401).send({ error: 'authentication_required' });
    }

    if (!canAccessRole(currentUser, ['admin', 'operator'])) {
      options.auditService.record({
        actorUserId: currentUser.id,
        action: 'security_event',
        resourceType: 'upload',
        result: 'blocked',
        metadata: {
          actorRole: currentUser.role,
          reason: 'insufficient_role',
          requiredRole: 'admin_or_operator',
        },
        ipHash: options.auditService.hashValue(request.ip),
        userAgentHash: options.auditService.hashValue(
          firstHeaderValue(request.headers['user-agent']),
        ),
      });

      return reply.code(403).send({ error: 'insufficient_role' });
    }

    const incomingFiles = await collectUploadFiles(request, options);

    if ('code' in incomingFiles) {
      recordUploadRejected(request, options, currentUser, incomingFiles);

      return reply.code(400).send({ error: incomingFiles.code });
    }

    const validatedFiles = options.fileValidationService.validateBatch(incomingFiles);

    if (!Array.isArray(validatedFiles)) {
      recordUploadRejected(request, options, currentUser, validatedFiles);

      return reply.code(400).send({ error: validatedFiles.code });
    }

    const expiresAt = new Date(Date.now() + options.ttlMinutes * 60 * 1000);
    const job = await options.jobRepository.createJob({
      createdByUserId: currentUser.id,
      expiresAt,
      totalFiles: validatedFiles.length,
    });
    const documents = [];

    for (const file of validatedFiles) {
      const storedFile = await options.storageService.saveOriginal({
        buffer: file.buffer,
        extension: file.extension,
        jobId: job.id,
        userId: currentUser.id,
      });
      const document = await options.jobRepository.createDocument({
        contentHash: file.contentHash,
        expiresAt,
        fileSizeBytes: file.fileSizeBytes,
        jobId: job.id,
        originalFileNameHash: file.originalFileNameHash,
        originalMimeType: file.mimeType,
        originalStorageKey: storedFile.storageKey,
        validationSummary: {
          extension: file.extension,
        },
      });

      documents.push(document);
    }

    options.auditService.record({
      actorUserId: currentUser.id,
      action: 'upload_completed',
      resourceId: job.id,
      resourceType: 'job',
      result: 'success',
      metadata: {
        documentCount: documents.length,
        totalBytes: validatedFiles.reduce((sum, file) => sum + file.fileSizeBytes, 0),
      },
      ipHash: options.auditService.hashValue(request.ip),
      userAgentHash: options.auditService.hashValue(
        firstHeaderValue(request.headers['user-agent']),
      ),
    });

    await options.jobRepository.updateJobStatus(job.id, 'queued');

    for (const document of documents) {
      await options.processingQueue.enqueueDocument(document.id);
    }

    const updatedJob = await options.jobRepository.getJobById(job.id);
    const updatedDocuments = await options.jobRepository.getDocumentsByJobId(job.id);

    return reply.code(201).send({
      documents: updatedDocuments.map((document) => ({
        id: document.id,
        fileSizeBytes: document.fileSizeBytes,
        mimeType: document.originalMimeType,
        status: document.status,
      })),
      job: {
        expiresAt: updatedJob?.expiresAt ?? job.expiresAt,
        id: updatedJob?.id ?? job.id,
        status: updatedJob?.status ?? job.status,
        totalFiles: updatedJob?.totalFiles ?? job.totalFiles,
      },
    });
  });
}

async function collectUploadFiles(
  request: FastifyRequest,
  options: UploadRoutesOptions,
): Promise<IncomingUploadFile[] | UploadValidationError> {
  if (!request.isMultipart()) {
    return { code: 'empty_batch' };
  }

  const files: IncomingUploadFile[] = [];

  try {
    for await (const part of request.files()) {
      if (files.length >= options.uploadLimits.maxBatchFiles + 1) {
        return { code: 'too_many_files' };
      }

      const buffer = await part.toBuffer();
      files.push({
        buffer,
        filename: part.filename,
        mimeType: part.mimetype,
      });
    }
  } catch {
    return { code: 'file_too_large' };
  }

  return files;
}

function recordUploadRejected(
  request: FastifyRequest,
  options: UploadRoutesOptions,
  currentUser: AuthenticatedUser,
  validationError: UploadValidationError,
): void {
  options.auditService.record({
    actorUserId: currentUser.id,
    action: 'upload_rejected',
    resourceType: 'upload',
    result: 'blocked',
    metadata: {
      fileNameHash: validationError.fileNameHash ?? null,
      reason: validationError.code,
    },
    ipHash: options.auditService.hashValue(request.ip),
    userAgentHash: options.auditService.hashValue(firstHeaderValue(request.headers['user-agent'])),
  });
}

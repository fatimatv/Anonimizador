import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { pathToFileURL } from 'node:url';
import { firstHeaderValue } from './common/utils/headers.js';
import { registerAuditRoutes } from './modules/audit/audit.routes.js';
import type { AuditService } from './modules/audit/audit.service.js';
import { getCurrentUserFromRequest, registerAuthRoutes } from './modules/auth/auth.routes.js';
import { DeletionService } from './modules/deletion/deletion.service.js';
import type { JobRepository } from './modules/documents/job.repository.js';
import { registerJobRoutes } from './modules/documents/job.routes.js';
import {
  createBullMqProcessingQueueFromEnv,
  InMemoryProcessingQueue,
  type ProcessingQueue,
} from './modules/processing/processing.queue.js';
import type { ProcessingService } from './modules/processing/processing.service.js';
import type { StorageService } from './modules/storage/storage.service.js';
import { FileValidationService } from './modules/upload/file-validation.service.js';
import { registerUploadRoutes } from './modules/upload/upload.routes.js';
import { resolveUploadLimits } from './modules/upload/upload.config.js';
import type { UserRepository } from './modules/users/user.repository.js';
import { closeRuntimeServices, createRuntimeServices } from './runtime/services.js';
import { createSessionServiceFromEnv, type SessionService } from './security/session.js';

const DEFAULT_PORT = 3001;

export interface BuildAppOptions {
  auditService?: AuditService;
  deletionService?: DeletionService;
  enableRetentionCleanup?: boolean;
  jobRepository?: JobRepository;
  processingQueue?: ProcessingQueue;
  sessionService?: SessionService;
  storageService?: StorageService;
  userRepository?: UserRepository;
}

function parseAllowedOrigins(): string[] | false {
  const configuredOrigin = process.env.WEB_ORIGIN;

  if (!configuredOrigin) {
    return false;
  }

  return configuredOrigin
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function isStateChangingMethod(method: string): boolean {
  return ['DELETE', 'PATCH', 'POST', 'PUT'].includes(method.toUpperCase());
}

function isAllowedRequestOrigin(origin: string, hostHeader: string | undefined): boolean {
  const allowedOrigins = parseAllowedOrigins();

  if (allowedOrigins && allowedOrigins.includes(origin)) {
    return true;
  }

  const host = firstHeaderValue(hostHeader);

  if (!host) {
    return false;
  }

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      process.env.NODE_ENV === 'test'
        ? false
        : {
            redact: [
              'req.headers.authorization',
              'req.headers.cookie',
              'res.headers["set-cookie"]',
            ],
          },
    trustProxy: false,
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        baseUri: ["'self'"],
        defaultSrc: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
      },
    },
  });

  await app.register(cors, {
    credentials: true,
    origin: parseAllowedOrigins(),
  });

  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });
  app.addHook('preHandler', async (request, reply) => {
    if (!isStateChangingMethod(request.method)) {
      return;
    }

    const origin = firstHeaderValue(request.headers.origin);

    if (origin && !isAllowedRequestOrigin(origin, request.headers.host)) {
      return reply.code(403).send({ error: 'invalid_origin' });
    }
  });

  const uploadLimits = resolveUploadLimits();

  await app.register(multipart, {
    limits: {
      fileSize: uploadLimits.maxFileSizeBytes + 1,
      files: uploadLimits.maxBatchFiles + 1,
    },
  });

  app.get('/health', async () => ({
    service: 'document-anonymizer-api',
    status: 'ok',
  }));

  const runtimeServiceOptions: Parameters<typeof createRuntimeServices>[0] = {};

  if (options.auditService) {
    runtimeServiceOptions.auditService = options.auditService;
  }

  if (options.jobRepository) {
    runtimeServiceOptions.jobRepository = options.jobRepository;
  }

  if (options.storageService) {
    runtimeServiceOptions.storageService = options.storageService;
  }

  if (options.userRepository) {
    runtimeServiceOptions.userRepository = options.userRepository;
  }

  const runtimeServices = await createRuntimeServices(runtimeServiceOptions);
  app.addHook('onClose', async () => {
    await closeRuntimeServices();
  });

  const {
    auditService,
    deletionService,
    jobRepository,
    processingService,
    storageService,
    userRepository,
  } = runtimeServices;
  const sessionService = options.sessionService ?? createSessionServiceFromEnv();
  const resolvedDeletionService = options.deletionService ?? deletionService;
  const processingQueue =
    options.processingQueue ?? createProcessingQueueFromEnv(processingService);
  app.addHook('onClose', async () => {
    await processingQueue.close?.();
  });
  const authOptions = {
    auditService,
    sessionService,
    userRepository,
  };

  await registerAuthRoutes(app, authOptions);
  await registerAuditRoutes(app, {
    auditService,
    getCurrentUser: (request) => getCurrentUserFromRequest(request, authOptions),
  });
  await registerJobRoutes(app, {
    auditService,
    deletionService: resolvedDeletionService,
    getCurrentUser: (request) => getCurrentUserFromRequest(request, authOptions),
    jobRepository,
    storageService,
  });
  await registerUploadRoutes(app, {
    auditService,
    fileValidationService: new FileValidationService(uploadLimits),
    getCurrentUser: (request) => getCurrentUserFromRequest(request, authOptions),
    jobRepository,
    processingQueue,
    storageService,
    ttlMinutes: Number(process.env.TEMP_FILE_TTL_MINUTES ?? 60),
    uploadLimits,
  });
  if (options.enableRetentionCleanup ?? process.env.VERCEL !== '1') {
    registerRetentionCleanup(app, resolvedDeletionService);
  }

  return app;
}

function createProcessingQueueFromEnv(processingService: ProcessingService): ProcessingQueue {
  if (process.env.PROCESSING_QUEUE_DRIVER === 'bullmq') {
    return createBullMqProcessingQueueFromEnv();
  }

  return new InMemoryProcessingQueue(processingService);
}

function registerRetentionCleanup(app: FastifyInstance, deletionService: DeletionService): void {
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  const intervalMs = Number(process.env.RETENTION_CLEANUP_INTERVAL_MS ?? 15 * 60 * 1000);

  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    return;
  }

  const interval = setInterval(() => {
    deletionService.deleteExpiredJobs().catch((error: unknown) => {
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      console.error('retention_cleanup_failed', { errorName });
    });
  }, intervalMs);

  interval.unref();
  app.addHook('onClose', () => {
    clearInterval(interval);
  });
}

export async function start(): Promise<void> {
  const app = await buildApp();
  const port = Number(process.env.API_PORT ?? DEFAULT_PORT);

  await app.listen({ host: '0.0.0.0', port });
}

const isMainModule = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isMainModule) {
  start().catch((error: unknown) => {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    console.error('api_start_failed', { errorName });
    process.exit(1);
  });
}

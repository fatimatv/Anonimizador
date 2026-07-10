import { disconnectPrismaClient, getPrismaClient } from '../infrastructure/prisma.js';
import {
  AuditService,
  PrismaAuditService,
  resolveAuditHashSecret,
} from '../modules/audit/audit.service.js';
import { AnonymizationService } from '../modules/anonymization/anonymization.service.js';
import { DeletionService } from '../modules/deletion/deletion.service.js';
import { InMemoryJobRepository, type JobRepository } from '../modules/documents/job.repository.js';
import { PrismaJobRepository } from '../modules/documents/prisma-job.repository.js';
import { DetectionService } from '../modules/detection/detection.service.js';
import { ProcessingService } from '../modules/processing/processing.service.js';
import { TextExtractionService } from '../modules/processing/text-extraction.service.js';
import {
  createStorageServiceFromEnv,
  type StorageService,
} from '../modules/storage/storage.service.js';
import {
  createBootstrapUserRepository,
  PrismaUserRepository,
  seedBootstrapUsers,
  type UserRepository,
} from '../modules/users/user.repository.js';

export interface RuntimeServices {
  auditService: AuditService;
  deletionService: DeletionService;
  jobRepository: JobRepository;
  processingService: ProcessingService;
  storageService: StorageService;
  userRepository: UserRepository;
}

export async function createRuntimeServices(options: {
  auditService?: AuditService;
  jobRepository?: JobRepository;
  storageService?: StorageService;
  userRepository?: UserRepository;
}): Promise<RuntimeServices> {
  const prisma = shouldUsePrisma(options) ? getPrismaClient() : null;

  if (prisma) {
    await seedBootstrapUsers(prisma);
  }

  const auditService =
    options.auditService ??
    (prisma
      ? new PrismaAuditService(resolveAuditHashSecret(), prisma)
      : new AuditService(resolveAuditHashSecret()));
  const jobRepository =
    options.jobRepository ??
    (prisma ? new PrismaJobRepository(prisma) : new InMemoryJobRepository());
  const storageService = options.storageService ?? createStorageServiceFromEnv();
  const userRepository =
    options.userRepository ??
    (prisma ? new PrismaUserRepository(prisma) : createBootstrapUserRepository());
  const deletionService = new DeletionService({
    auditService,
    jobRepository,
    storageService,
  });
  const processingService = new ProcessingService({
    auditService,
    anonymizationService: new AnonymizationService(),
    detectionService: new DetectionService(),
    jobRepository,
    storageService,
    textExtractionService: new TextExtractionService(),
  });

  return {
    auditService,
    deletionService,
    jobRepository,
    processingService,
    storageService,
    userRepository,
  };
}

export async function closeRuntimeServices(): Promise<void> {
  await disconnectPrismaClient();
}

function shouldUsePrisma(options: {
  auditService?: AuditService;
  jobRepository?: JobRepository;
  userRepository?: UserRepository;
}): boolean {
  if (options.jobRepository || options.userRepository || options.auditService) {
    return false;
  }

  return Boolean(process.env.DATABASE_URL) && process.env.NODE_ENV !== 'test';
}

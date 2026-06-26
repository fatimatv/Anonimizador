import type { AuditService } from '../audit/audit.service.js';
import type { JobRepository } from '../documents/job.repository.js';
import type { StorageService } from '../storage/storage.service.js';

export class DeletionService {
  constructor(
    private readonly options: {
      auditService: AuditService;
      jobRepository: JobRepository;
      storageService: StorageService;
    },
  ) {}

  async deleteJob(input: {
    actorUserId: string | null;
    jobId: string;
    reason: 'expired_ttl' | 'manual';
  }): Promise<{ deletedDocuments: number }> {
    const documents = await this.options.jobRepository.getDocumentsByJobId(input.jobId);

    for (const document of documents) {
      await this.options.storageService.delete(document.originalStorageKey);
      await this.options.storageService.delete(document.anonymizedStorageKey);
    }

    await this.options.jobRepository.markJobDeleted(input.jobId);
    this.options.auditService.record({
      actorUserId: input.actorUserId,
      action: 'deletion_completed',
      resourceId: input.jobId,
      resourceType: 'job',
      result: 'success',
      metadata: {
        deletedDocuments: documents.length,
        jobId: input.jobId,
        reason: input.reason,
      },
    });

    return {
      deletedDocuments: documents.length,
    };
  }

  async deleteExpiredJobs(now = new Date()): Promise<number> {
    const expiredJobs = await this.options.jobRepository.listExpiredJobs(now);

    for (const job of expiredJobs) {
      await this.deleteJob({
        actorUserId: null,
        jobId: job.id,
        reason: 'expired_ttl',
      });
    }

    return expiredJobs.length;
  }
}

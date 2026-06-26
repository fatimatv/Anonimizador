import { Queue, Worker, type JobsOptions, type QueueOptions, type WorkerOptions } from 'bullmq';
import type { ProcessingService } from './processing.service.js';

export interface ProcessingQueue {
  enqueueDocument(documentId: string): Promise<void>;
}

export class InMemoryProcessingQueue implements ProcessingQueue {
  constructor(private readonly processingService: ProcessingService) {}

  async enqueueDocument(documentId: string): Promise<void> {
    await this.processingService.processDocument(documentId);
  }
}

export class BullMqProcessingQueue implements ProcessingQueue {
  constructor(
    private readonly queue: Queue<{ documentId: string }>,
    private readonly jobOptions: JobsOptions = {
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: 100,
    },
  ) {}

  async enqueueDocument(documentId: string): Promise<void> {
    await this.queue.add('extract-text', { documentId }, this.jobOptions);
  }
}

export function createBullMqProcessingQueue(options: QueueOptions): BullMqProcessingQueue {
  return new BullMqProcessingQueue(new Queue('document-processing', options));
}

export function createBullMqProcessingWorker(
  processingService: ProcessingService,
  options: WorkerOptions,
): Worker<{ documentId: string }> {
  return new Worker<{ documentId: string }>(
    'document-processing',
    async (job) => {
      await processingService.processDocument(job.data.documentId);
    },
    options,
  );
}

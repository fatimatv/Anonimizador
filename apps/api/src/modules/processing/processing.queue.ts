import { Queue, Worker, type JobsOptions, type QueueOptions, type WorkerOptions } from 'bullmq';
import type { ProcessingService } from './processing.service.js';

export interface ProcessingQueue {
  close?(): Promise<void>;
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

  async close(): Promise<void> {
    await this.queue.close();
  }
}

export function createBullMqProcessingQueue(options: QueueOptions): BullMqProcessingQueue {
  return new BullMqProcessingQueue(new Queue('document-processing', options));
}

export function createBullMqProcessingQueueFromEnv(): BullMqProcessingQueue {
  return createBullMqProcessingQueue({
    connection: createRedisConnectionOptionsFromEnv(),
  });
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

export function createBullMqProcessingWorkerFromEnv(
  processingService: ProcessingService,
): Worker<{ documentId: string }> {
  return createBullMqProcessingWorker(processingService, {
    connection: createRedisConnectionOptionsFromEnv(),
  });
}

export function createRedisConnectionOptionsFromEnv(): NonNullable<QueueOptions['connection']> {
  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    throw new Error('REDIS_URL is required for BullMQ processing');
  }

  const parsedUrl = new URL(redisUrl);

  return {
    db: parsedUrl.pathname.length > 1 ? Number(parsedUrl.pathname.slice(1)) : 0,
    host: parsedUrl.hostname,
    maxRetriesPerRequest: null,
    password: parsedUrl.password ? decodeURIComponent(parsedUrl.password) : undefined,
    port: parsedUrl.port ? Number(parsedUrl.port) : 6379,
    tls: parsedUrl.protocol === 'rediss:' ? {} : undefined,
    username: parsedUrl.username ? decodeURIComponent(parsedUrl.username) : undefined,
  } satisfies NonNullable<QueueOptions['connection']>;
}

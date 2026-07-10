import { pathToFileURL } from 'node:url';
import { createBullMqProcessingWorkerFromEnv } from './modules/processing/processing.queue.js';
import { closeRuntimeServices, createRuntimeServices } from './runtime/services.js';

export async function startWorker(): Promise<void> {
  const { processingService } = await createRuntimeServices({});
  const worker = createBullMqProcessingWorkerFromEnv(processingService);

  worker.on('failed', (job, error) => {
    console.error('processing_worker_job_failed', {
      errorName: error.name,
      jobId: job?.id,
    });
  });

  const close = async () => {
    await worker.close();
    await closeRuntimeServices();
  };

  process.once('SIGINT', () => {
    close()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  });
  process.once('SIGTERM', () => {
    close()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  });
}

const isMainModule = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isMainModule) {
  startWorker().catch((error: unknown) => {
    const errorName = error instanceof Error ? error.name : 'UnknownError';

    console.error('processing_worker_start_failed', { errorName });
    process.exit(1);
  });
}

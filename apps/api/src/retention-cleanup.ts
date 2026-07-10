import { pathToFileURL } from 'node:url';
import { closeRuntimeServices, createRuntimeServices } from './runtime/services.js';

export async function runRetentionCleanup(): Promise<number> {
  const { deletionService } = await createRuntimeServices({});

  try {
    return await deletionService.deleteExpiredJobs();
  } finally {
    await closeRuntimeServices();
  }
}

const isMainModule = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isMainModule) {
  runRetentionCleanup()
    .then((deletedJobs) => {
      console.warn('retention_cleanup_completed', { deletedJobs });
    })
    .catch((error: unknown) => {
      const errorName = error instanceof Error ? error.name : 'UnknownError';

      console.error('retention_cleanup_failed', { errorName });
      process.exit(1);
    });
}

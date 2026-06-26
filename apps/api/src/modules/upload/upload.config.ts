export interface UploadLimits {
  maxBatchFiles: number;
  maxFileSizeBytes: number;
  maxFileSizeMb: number;
}

const DEFAULT_MAX_BATCH_FILES = 20;
const DEFAULT_MAX_FILE_SIZE_MB = 20;

export function resolveUploadLimits(): UploadLimits {
  const maxBatchFiles = Number(process.env.MAX_BATCH_FILES ?? DEFAULT_MAX_BATCH_FILES);
  const maxFileSizeMb = Number(process.env.MAX_FILE_SIZE_MB ?? DEFAULT_MAX_FILE_SIZE_MB);

  return {
    maxBatchFiles,
    maxFileSizeBytes: maxFileSizeMb * 1024 * 1024,
    maxFileSizeMb,
  };
}

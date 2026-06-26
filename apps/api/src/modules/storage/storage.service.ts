import { createHmac, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export interface StoredFileRecord {
  storageKey: string;
  absolutePath: string;
}

export class StorageService {
  constructor(
    private readonly rootPath: string,
    private readonly keySecret: string,
  ) {}

  async saveOriginal(input: {
    buffer: Buffer;
    extension: string;
    jobId: string;
    userId: string;
  }): Promise<StoredFileRecord> {
    const userHash = this.hashPathSegment(input.userId);
    const fileKey = `${randomUUID()}${input.extension}`;
    const relativeKey = path.posix.join(
      'users',
      userHash,
      'jobs',
      input.jobId,
      'original',
      fileKey,
    );
    const absolutePath = this.resolveStoragePath(relativeKey);

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, input.buffer, { flag: 'wx' });

    return {
      absolutePath,
      storageKey: relativeKey,
    };
  }

  async saveAnonymized(input: {
    buffer: Buffer;
    extension: string;
    originalStorageKey: string;
  }): Promise<StoredFileRecord> {
    const normalizedOriginalKey = input.originalStorageKey.replaceAll('\\', '/');

    if (!normalizedOriginalKey.includes('/original/')) {
      throw new Error('Original storage key does not reference an original file');
    }

    const anonymizedKey = normalizedOriginalKey.replace(
      /\/original\/[^/]+$/u,
      `/anonymized/${randomUUID()}${input.extension}`,
    );
    const absolutePath = this.resolveStoragePath(anonymizedKey);

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, input.buffer, { flag: 'wx' });

    return {
      absolutePath,
      storageKey: anonymizedKey,
    };
  }

  async read(storageKey: string): Promise<Buffer> {
    return await fs.readFile(this.resolveStoragePath(storageKey));
  }

  async delete(storageKey: string | null | undefined): Promise<void> {
    if (!storageKey) {
      return;
    }

    await fs.rm(this.resolveStoragePath(storageKey), { force: true });
  }

  resolveStoragePath(storageKey: string): string {
    const normalizedKey = storageKey.replaceAll('\\', '/');

    if (normalizedKey.startsWith('/') || normalizedKey.includes('..')) {
      throw new Error('Invalid storage key');
    }

    const resolvedPath = path.resolve(this.rootPath, normalizedKey);
    const resolvedRoot = path.resolve(this.rootPath);

    if (!resolvedPath.startsWith(resolvedRoot + path.sep)) {
      throw new Error('Storage key escapes root');
    }

    return resolvedPath;
  }

  private hashPathSegment(value: string): string {
    return createHmac('sha256', this.keySecret).update(value).digest('hex').slice(0, 32);
  }
}

export function createStorageServiceFromEnv(): StorageService {
  const storageRoot = process.env.TEMP_STORAGE_ROOT ?? path.resolve('tmp-storage');
  const keySecret =
    process.env.AUDIT_HASH_SECRET ??
    process.env.SESSION_SECRET ??
    'development-only-storage-secret';

  return new StorageService(storageRoot, keySecret);
}

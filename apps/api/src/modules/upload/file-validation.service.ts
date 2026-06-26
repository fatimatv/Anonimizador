import { createHash } from 'node:crypto';
import path from 'node:path';
import type { UploadLimits } from './upload.config.js';

export type UploadValidationErrorCode =
  | 'empty_batch'
  | 'empty_file'
  | 'file_too_large'
  | 'mime_mismatch'
  | 'too_many_files'
  | 'unsafe_file_name'
  | 'unsupported_extension';

export interface IncomingUploadFile {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}

export interface ValidatedUploadFile {
  buffer: Buffer;
  contentHash: string;
  extension: SupportedUploadExtension;
  fileSizeBytes: number;
  mimeType: SupportedUploadMimeType;
  originalFileNameHash: string;
}

export interface UploadValidationError {
  code: UploadValidationErrorCode;
  fileNameHash?: string;
}

export type SupportedUploadExtension = '.txt' | '.pdf' | '.docx';

export type SupportedUploadMimeType =
  | 'application/pdf'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  | 'text/plain';

const mimeByExtension: Record<SupportedUploadExtension, SupportedUploadMimeType> = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
};

const supportedExtensions = new Set(Object.keys(mimeByExtension));

export class FileValidationService {
  constructor(private readonly limits: UploadLimits) {}

  validateBatch(files: IncomingUploadFile[]): ValidatedUploadFile[] | UploadValidationError {
    if (files.length === 0) {
      return { code: 'empty_batch' };
    }

    if (files.length > this.limits.maxBatchFiles) {
      return { code: 'too_many_files' };
    }

    const validatedFiles: ValidatedUploadFile[] = [];

    for (const file of files) {
      const fileNameHash = hashValue(file.filename);

      if (!isSafeFileName(file.filename)) {
        return { code: 'unsafe_file_name', fileNameHash };
      }

      const extension = path.extname(file.filename).toLowerCase();

      if (!supportedExtensions.has(extension)) {
        return { code: 'unsupported_extension', fileNameHash };
      }

      const supportedExtension = extension as SupportedUploadExtension;

      if (file.buffer.length === 0) {
        return { code: 'empty_file', fileNameHash };
      }

      if (file.buffer.length > this.limits.maxFileSizeBytes) {
        return { code: 'file_too_large', fileNameHash };
      }

      const expectedMimeType = mimeByExtension[supportedExtension];
      const normalizedMimeType = normalizeMimeType(file.mimeType);

      if (
        normalizedMimeType !== expectedMimeType ||
        !contentMatchesExtension(file.buffer, supportedExtension)
      ) {
        return { code: 'mime_mismatch', fileNameHash };
      }

      validatedFiles.push({
        buffer: file.buffer,
        contentHash: hashBuffer(file.buffer),
        extension: supportedExtension,
        fileSizeBytes: file.buffer.length,
        mimeType: expectedMimeType,
        originalFileNameHash: fileNameHash,
      });
    }

    return validatedFiles;
  }
}

export function hashBuffer(buffer: Buffer): string {
  return `sha256:${createHash('sha256').update(buffer).digest('hex')}`;
}

export function hashValue(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function isSafeFileName(filename: string): boolean {
  if (!filename || filename.length > 255 || hasControlCharacter(filename)) {
    return false;
  }

  if (
    filename.includes('/') ||
    filename.includes('\\') ||
    path.posix.basename(filename) !== filename ||
    path.win32.basename(filename) !== filename
  ) {
    return false;
  }

  const segments = filename.split('.');

  if (segments.includes('') || segments.includes('..') || filename.includes('..')) {
    return false;
  }

  return true;
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    if (character.charCodeAt(0) <= 31) {
      return true;
    }
  }

  return false;
}

function normalizeMimeType(mimeType: string): string {
  return mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
}

function contentMatchesExtension(buffer: Buffer, extension: SupportedUploadExtension): boolean {
  if (extension === '.pdf') {
    return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  }

  if (extension === '.docx') {
    return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
  }

  return (
    !buffer.includes(0x00) &&
    !contentMatchesExtension(buffer, '.pdf') &&
    !contentMatchesExtension(buffer, '.docx')
  );
}

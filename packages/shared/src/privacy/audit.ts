import type { SafeAuditMetadata } from '../types/index';

export const forbiddenAuditMetadataKeys = [
  'rawValue',
  'rawText',
  'documentText',
  'snippet',
  'content',
  'originalFileName',
] as const;

export function assertSafeAuditMetadata(metadata: SafeAuditMetadata): SafeAuditMetadata {
  const serializedMetadata = JSON.stringify(metadata).toLowerCase();

  for (const forbiddenKey of forbiddenAuditMetadataKeys) {
    if (serializedMetadata.includes(forbiddenKey.toLowerCase())) {
      throw new Error('Unsafe audit metadata key detected');
    }
  }

  return metadata;
}

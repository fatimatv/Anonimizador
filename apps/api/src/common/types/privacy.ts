export type UserRole = 'admin' | 'reviewer' | 'operator';

export type AuditAction =
  | 'login'
  | 'logout'
  | 'upload_started'
  | 'upload_rejected'
  | 'upload_completed'
  | 'processing_started'
  | 'detection_completed'
  | 'anonymization_completed'
  | 'review_approved'
  | 'review_rejected'
  | 'download_anonymized'
  | 'deletion_requested'
  | 'deletion_completed'
  | 'security_event';

export type AuditResult = 'success' | 'failure' | 'blocked';

export type SafeAuditPrimitive = string | number | boolean | null;

export type SafeAuditMetadata =
  | SafeAuditPrimitive
  | SafeAuditMetadata[]
  | {
      [key: string]: SafeAuditMetadata;
    };

const forbiddenAuditMetadataKeys = [
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

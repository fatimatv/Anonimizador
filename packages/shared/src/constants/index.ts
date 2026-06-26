export const userRoles = ['admin', 'reviewer', 'operator'] as const;

export const auditActions = [
  'login',
  'logout',
  'upload_started',
  'upload_rejected',
  'upload_completed',
  'processing_started',
  'detection_completed',
  'anonymization_completed',
  'review_approved',
  'review_rejected',
  'download_anonymized',
  'deletion_requested',
  'deletion_completed',
  'security_event',
] as const;

export const auditResults = ['success', 'failure', 'blocked'] as const;

export const jobStatuses = [
  'uploaded',
  'queued',
  'processing',
  'needs_review',
  'approved',
  'rejected',
  'completed',
  'failed',
  'deleted',
] as const;

export const documentStatuses = [
  'uploaded',
  'extracting_text',
  'detecting_entities',
  'anonymizing',
  'needs_review',
  'approved',
  'rejected',
  'completed',
  'failed',
  'deleted',
] as const;

export const supportedFileExtensions = ['.txt', '.pdf', '.docx'] as const;

export const supportedMimeTypes = [
  'text/plain',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

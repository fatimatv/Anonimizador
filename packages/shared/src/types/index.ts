import type {
  auditActions,
  auditResults,
  documentStatuses,
  jobStatuses,
  supportedFileExtensions,
  userRoles,
} from '../constants/index';

export type UserRole = (typeof userRoles)[number];

export type AuditAction = (typeof auditActions)[number];

export type AuditResult = (typeof auditResults)[number];

export type JobStatus = (typeof jobStatuses)[number];

export type DocumentStatus = (typeof documentStatuses)[number];

export type SupportedFileExtension = (typeof supportedFileExtensions)[number];

export type SafeAuditPrimitive = string | number | boolean | null;

export type SafeAuditMetadata =
  | SafeAuditPrimitive
  | SafeAuditMetadata[]
  | {
      [key: string]: SafeAuditMetadata;
    };

import { createHmac, randomUUID } from 'node:crypto';
import {
  assertSafeAuditMetadata,
  type AuditAction,
  type AuditResult,
  type SafeAuditMetadata,
} from '../../common/types/privacy.js';

export interface AuditRecordInput {
  actorUserId: string | null;
  action: AuditAction;
  resourceType: string;
  resourceId?: string | null;
  result: AuditResult;
  metadata?: SafeAuditMetadata;
  ipHash?: string | null;
  userAgentHash?: string | null;
}

export interface AuditEventRecord {
  id: string;
  actorUserId: string | null;
  action: AuditAction;
  resourceType: string;
  resourceId: string | null;
  result: AuditResult;
  metadata: SafeAuditMetadata | null;
  ipHash: string | null;
  userAgentHash: string | null;
  createdAt: string;
}

export class AuditService {
  private readonly events: AuditEventRecord[] = [];

  constructor(private readonly hashSecret: string) {}

  record(input: AuditRecordInput): AuditEventRecord {
    const metadata = input.metadata === undefined ? null : assertSafeAuditMetadata(input.metadata);

    const event: AuditEventRecord = {
      id: randomUUID(),
      actorUserId: input.actorUserId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      result: input.result,
      metadata,
      ipHash: input.ipHash ?? null,
      userAgentHash: input.userAgentHash ?? null,
      createdAt: new Date().toISOString(),
    };

    this.events.push(event);

    return event;
  }

  list(limit = 100): AuditEventRecord[] {
    return this.events.slice(-limit).reverse();
  }

  hashValue(value: string | null | undefined): string | null {
    if (!value) {
      return null;
    }

    const digest = createHmac('sha256', this.hashSecret).update(value).digest('hex');

    return `sha256:${digest}`;
  }
}

export function resolveAuditHashSecret(): string {
  const configuredSecret = process.env.AUDIT_HASH_SECRET;

  if (configuredSecret) {
    return configuredSecret;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('AUDIT_HASH_SECRET is required in production');
  }

  return 'development-only-audit-hash-secret';
}

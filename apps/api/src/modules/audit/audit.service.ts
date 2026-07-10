import { createHmac, randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
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

export class PrismaAuditService extends AuditService {
  constructor(
    hashSecret: string,
    private readonly prisma: PrismaClient,
  ) {
    super(hashSecret);
  }

  override record(input: AuditRecordInput): AuditEventRecord {
    const event = super.record(input);

    const data: Prisma.AuditEventUncheckedCreateInput = {
      action: event.action,
      actorUserId: event.actorUserId,
      createdAt: new Date(event.createdAt),
      id: event.id,
      ipHash: event.ipHash,
      resourceId: event.resourceId,
      resourceType: event.resourceType,
      result: event.result,
      userAgentHash: event.userAgentHash,
    };

    if (event.metadata !== null) {
      data.metadata = event.metadata as Prisma.InputJsonValue;
    }

    void this.prisma.auditEvent
      .create({
        data,
      })
      .catch((error: unknown) => {
        const errorName = error instanceof Error ? error.name : 'UnknownError';

        console.error('audit_persistence_failed', { errorName });
      });

    return event;
  }

  async listPersisted(limit = 100): Promise<AuditEventRecord[]> {
    const events = await this.prisma.auditEvent.findMany({
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
    });
    const persistedEvents = events.map((event) => ({
      action: event.action,
      actorUserId: event.actorUserId,
      createdAt: event.createdAt.toISOString(),
      id: event.id,
      ipHash: event.ipHash,
      metadata: event.metadata as AuditEventRecord['metadata'],
      resourceId: event.resourceId,
      resourceType: event.resourceType,
      result: event.result,
      userAgentHash: event.userAgentHash,
    }));

    return mergeRecentEvents(super.list(limit), persistedEvents).slice(0, limit);
  }
}

function mergeRecentEvents(
  memoryEvents: readonly AuditEventRecord[],
  persistedEvents: readonly AuditEventRecord[],
): AuditEventRecord[] {
  const eventsById = new Map<string, AuditEventRecord>();

  for (const event of [...memoryEvents, ...persistedEvents]) {
    eventsById.set(event.id, event);
  }

  return [...eventsById.values()].sort((left, right) => {
    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  });
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

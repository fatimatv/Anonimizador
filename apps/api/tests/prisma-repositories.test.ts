import { describe, expect, it, vi } from 'vitest';
import { PrismaJobRepository } from '../src/modules/documents/prisma-job.repository.js';
import { PrismaUserRepository } from '../src/modules/users/user.repository.js';

const now = new Date('2026-07-10T00:00:00.000Z');

describe('PrismaUserRepository', () => {
  it('normalizes email lookup and maps persisted lockout fields', async () => {
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          createdAt: now,
          email: 'admin@example.local',
          failedLoginAttempts: 2,
          id: 'user-1',
          isActive: true,
          lockedUntil: now,
          passwordHash: 'hash',
          role: 'admin',
          updatedAt: now,
        }),
      },
    };
    const repository = new PrismaUserRepository(prisma as never);

    const user = await repository.findByEmail(' ADMIN@example.local ');

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: {
        email: 'admin@example.local',
      },
    });
    expect(user).toMatchObject({
      failedLoginAttempts: 2,
      id: 'user-1',
      lockedUntil: now,
      role: 'admin',
    });
  });

  it('locks a user after persisted failed login attempts reach the threshold', async () => {
    const update = vi
      .fn()
      .mockResolvedValueOnce({
        failedLoginAttempts: 5,
      })
      .mockResolvedValueOnce({});
    const repository = new PrismaUserRepository(
      {
        user: {
          update,
        },
      } as never,
      {
        lockAfterAttempts: 5,
        lockMinutes: 15,
      },
    );

    await repository.recordFailedLogin('user-1');

    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenLastCalledWith({
      data: {
        lockedUntil: expect.any(Date),
      },
      where: {
        id: 'user-1',
      },
    });
  });
});

describe('PrismaJobRepository', () => {
  it('creates jobs with persisted expiry and owner', async () => {
    const prisma = {
      job: {
        create: vi.fn().mockResolvedValue({
          createdAt: now,
          createdByUserId: 'user-1',
          expiresAt: now,
          failedFiles: 0,
          id: 'job-1',
          processedFiles: 0,
          riskLevel: 'low',
          status: 'uploaded',
          totalFiles: 1,
          updatedAt: now,
        }),
      },
    };
    const repository = new PrismaJobRepository(prisma as never);

    const job = await repository.createJob({
      createdByUserId: 'user-1',
      expiresAt: now,
      totalFiles: 1,
    });

    expect(prisma.job.create).toHaveBeenCalledWith({
      data: {
        createdByUserId: 'user-1',
        expiresAt: now,
        status: 'uploaded',
        totalFiles: 1,
      },
    });
    expect(job).toMatchObject({
      createdByUserId: 'user-1',
      expiresAt: now.toISOString(),
      id: 'job-1',
    });
  });

  it('replaces detected entities before persisting new detections', async () => {
    const prisma = {
      detectedEntity: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        findMany: vi.fn().mockResolvedValue([
          {
            category: 'identifier',
            confidence: 0.9,
            contextWindowHash: 'hmac-sha256:context',
            createdAt: now,
            documentId: 'doc-1',
            endOffset: 12,
            entityType: 'dni',
            id: 'entity-1',
            previewMasked: '****5678',
            rawValueHash: 'hmac-sha256:value',
            replacementType: 'mask',
            ruleId: 'dni-rule',
            startOffset: 4,
          },
        ]),
      },
    };
    const repository = new PrismaJobRepository(prisma as never);

    const detections = await repository.createDetectedEntities('doc-1', [
      {
        category: 'identifier',
        confidence: 0.9,
        contextWindowHash: 'hmac-sha256:context',
        endOffset: 12,
        entityType: 'dni',
        previewMasked: '****5678',
        rawValueHash: 'hmac-sha256:value',
        replacementType: 'mask',
        ruleId: 'dni-rule',
        startOffset: 4,
      },
    ]);

    expect(prisma.detectedEntity.deleteMany).toHaveBeenCalledWith({
      where: {
        documentId: 'doc-1',
      },
    });
    expect(prisma.detectedEntity.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          documentId: 'doc-1',
          rawValueHash: 'hmac-sha256:value',
        }),
      ],
    });
    expect(detections).toEqual([
      expect.objectContaining({
        id: 'entity-1',
        rawValueHash: 'hmac-sha256:value',
      }),
    ]);
  });
});

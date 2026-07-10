import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { PrismaJobRepository } from '../src/modules/documents/prisma-job.repository.js';
import { PrismaUserRepository, seedBootstrapUsers } from '../src/modules/users/user.repository.js';

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for Prisma integration tests');
  }

  process.env.BOOTSTRAP_ADMIN_EMAIL = 'integration-admin@example.local';
  process.env.BOOTSTRAP_ADMIN_PASSWORD_HASH =
    '$argon2id$v=19$m=65536,t=3,p=4$ZjYJHLpFskwDZ+qlDiG5EQ$VqaCDi8Cc4s/iNqkJqrC5AEF/DZQVW0knU2hEwyq6Zg';

  const prisma = new PrismaClient();
  const runId = `integration-${Date.now()}`;
  let jobId: string | null = null;

  try {
    await seedBootstrapUsers(prisma);

    const userRepository = new PrismaUserRepository(prisma, {
      lockAfterAttempts: 1,
      lockMinutes: 5,
    });
    const admin = await userRepository.findByEmail('integration-admin@example.local');

    assert.equal(admin?.role, 'admin');
    await userRepository.recordFailedLogin(admin.id);
    const lockedAdmin = await userRepository.findById(admin.id);

    assert.ok(lockedAdmin?.lockedUntil instanceof Date);

    const jobRepository = new PrismaJobRepository(prisma);
    const job = await jobRepository.createJob({
      createdByUserId: admin.id,
      expiresAt: new Date(Date.now() + 60_000),
      totalFiles: 1,
    });
    jobId = job.id;
    const document = await jobRepository.createDocument({
      contentHash: `sha256:${runId}`,
      expiresAt: new Date(Date.now() + 60_000),
      fileSizeBytes: 12,
      jobId: job.id,
      originalFileNameHash: `sha256:file-${runId}`,
      originalMimeType: 'text/plain',
      originalStorageKey: `integration/${runId}/original.txt`,
      validationSummary: {
        extension: '.txt',
      },
    });

    await jobRepository.createDetectedEntities(document.id, [
      {
        category: 'identifier',
        confidence: 0.9,
        contextWindowHash: `hmac-sha256:context-${runId}`,
        endOffset: 12,
        entityType: 'dni',
        previewMasked: '****5678',
        rawValueHash: `hmac-sha256:value-${runId}`,
        replacementType: 'mask',
        ruleId: 'integration-dni',
        startOffset: 4,
      },
    ]);
    const detections = await jobRepository.getDetectedEntitiesByDocumentId(document.id);

    assert.equal(detections.length, 1);
    assert.equal(detections[0]?.rawValueHash, `hmac-sha256:value-${runId}`);
  } finally {
    await prisma.detectedEntity.deleteMany({
      where: {
        rawValueHash: `hmac-sha256:value-${runId}`,
      },
    });
    await prisma.document.deleteMany({
      where: {
        contentHash: `sha256:${runId}`,
      },
    });
    await prisma.job.deleteMany({
      where: {
        id: jobId ?? '',
      },
    });
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const errorName = error instanceof Error ? error.name : 'UnknownError';

  console.error('prisma_integration_failed', { errorName });
  process.exit(1);
});

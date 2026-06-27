import * as argon2 from 'argon2';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/main.js';
import { AuditService } from '../src/modules/audit/audit.service.js';
import { InMemoryJobRepository } from '../src/modules/documents/job.repository.js';
import { StorageService } from '../src/modules/storage/storage.service.js';
import { InMemoryUserRepository, type UserRecord } from '../src/modules/users/user.repository.js';
import { SessionService } from '../src/security/session.js';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((tempRoot) => fs.rm(tempRoot, { force: true, recursive: true })),
  );
});

async function createUploadTestApp(role: UserRecord['role'] = 'operator') {
  const now = new Date();
  const user: UserRecord = {
    createdAt: now,
    email: `${role}@example.local`,
    failedLoginAttempts: 0,
    id: `${role}-user`,
    isActive: true,
    lockedUntil: null,
    passwordHash: await argon2.hash('correct-password'),
    role,
    updatedAt: now,
  };
  const auditService = new AuditService('upload-test-audit-secret');
  const jobRepository = new InMemoryJobRepository();
  const tempRoot = path.join(
    'C:\\Users\\Fátima Toche\\Anonimizador',
    'tmp-storage-tests',
    randomUUID(),
  );
  const storageService = new StorageService(tempRoot, 'upload-test-storage-secret');
  const userRepository = new InMemoryUserRepository({ users: [user] });
  const sessionService = new SessionService({
    cookieName: 'upload_test_session',
    secret: 'upload-test-session-secret',
    ttlSeconds: 300,
  });
  const app = await buildApp({
    auditService,
    jobRepository,
    sessionService,
    storageService,
    userRepository,
  });

  tempRoots.push(tempRoot);

  const loginResponse = await app.inject({
    method: 'POST',
    payload: {
      email: user.email,
      password: 'correct-password',
    },
    url: '/auth/login',
  });
  const cookieHeader = String(loginResponse.headers['set-cookie']).split(';')[0] ?? '';

  return {
    app,
    auditService,
    cookieHeader,
    jobRepository,
    storageService,
  };
}

interface MultipartFileInput {
  content: Buffer | string;
  filename: string;
  mimeType: string;
}

function multipartPayload(files: MultipartFileInput[]) {
  const boundary = `----codex-upload-${randomUUID()}`;
  const chunks: Buffer[] = [];

  for (const file of files) {
    chunks.push(
      Buffer.from(
        [
          `--${boundary}`,
          `Content-Disposition: form-data; name="files"; filename="${file.filename}"`,
          `Content-Type: ${file.mimeType}`,
          '',
          '',
        ].join('\r\n'),
      ),
    );
    chunks.push(Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content));
    chunks.push(Buffer.from('\r\n'));
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`));

  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    payload: Buffer.concat(chunks),
  };
}

describe('upload module', () => {
  it('returns authenticated upload limits', async () => {
    const { app, cookieHeader } = await createUploadTestApp();

    const response = await app.inject({
      headers: { cookie: cookieHeader },
      method: 'GET',
      url: '/uploads/limits',
    });

    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      maxBatchFiles: 20,
      maxFileSizeMb: 20,
      supportedExtensions: ['.txt', '.pdf', '.docx'],
    });
  });

  it('accepts and locally processes a valid txt upload without returning names or storage paths', async () => {
    const { app, auditService, cookieHeader, jobRepository } = await createUploadTestApp();
    const originalText = 'Texto de prueba para anonimizar mas adelante.';
    const multipart = multipartPayload([
      {
        content: originalText,
        filename: 'reporte.txt',
        mimeType: 'text/plain',
      },
    ]);

    const response = await app.inject({
      headers: {
        'content-type': multipart.contentType,
        cookie: cookieHeader,
      },
      method: 'POST',
      payload: multipart.payload,
      url: '/uploads/batch',
    });

    await app.close();

    const body = response.json();
    const serializedBody = JSON.stringify(body);
    const documents = await jobRepository.getDocumentsByJobId(body.job.id);

    expect(response.statusCode).toBe(201);
    expect(body).toMatchObject({
      documents: [
        {
          anonymizedText: originalText,
          fileSizeBytes: expect.any(Number),
          mimeType: 'text/plain',
          status: 'needs_review',
        },
      ],
      job: {
        status: 'needs_review',
        totalFiles: 1,
      },
    });
    expect(serializedBody).not.toContain('reporte.txt');
    expect(serializedBody).not.toContain('tmp-storage');
    expect(documents[0]?.originalStorageKey).toContain('/original/');
    expect(documents[0]?.originalStorageKey).not.toContain('reporte');
    expect(documents[0]?.validationSummary.extraction).toEqual({
      extractedTextHash: expect.stringMatching(/^sha256:/u),
      extractedTextLength: originalText.length,
    });
    expect(documents[0]?.anonymizedStorageKey).toContain('/anonymized/');
    expect(documents[0]?.anonymizedContentHash).toEqual(expect.stringMatching(/^sha256:/u));
    expect(documents[0]?.validationSummary.anonymization).toMatchObject({
      anonymizedContentHash: expect.stringMatching(/^sha256:/u),
      outputExtension: '.txt',
      outputMimeType: 'text/plain',
      replacementsApplied: 0,
    });
    expect(auditService.list()).toEqual([
      expect.objectContaining({
        action: 'anonymization_completed',
        result: 'success',
      }),
      expect.objectContaining({
        action: 'detection_completed',
        result: 'success',
      }),
      expect.objectContaining({
        action: 'processing_started',
        result: 'success',
      }),
      expect.objectContaining({
        action: 'upload_completed',
        result: 'success',
      }),
      expect.objectContaining({
        action: 'login',
      }),
    ]);
  });

  it('detects sensitive entities and returns only masked detection metadata', async () => {
    const { app, auditService, cookieHeader, jobRepository } = await createUploadTestApp();
    const originalText = 'DNI 12345678. Correo persona@example.com. Tarjeta 4111 1111 1111 1111.';
    const multipart = multipartPayload([
      {
        content: originalText,
        filename: 'sensibles.txt',
        mimeType: 'text/plain',
      },
    ]);

    const uploadResponse = await app.inject({
      headers: {
        'content-type': multipart.contentType,
        cookie: cookieHeader,
      },
      method: 'POST',
      payload: multipart.payload,
      url: '/uploads/batch',
    });
    const uploadBody = uploadResponse.json();
    const documentId = uploadBody.documents[0].id as string;
    const detectionsResponse = await app.inject({
      headers: {
        cookie: cookieHeader,
      },
      method: 'GET',
      url: `/documents/${documentId}/detections`,
    });

    await app.close();

    const detectionsBody = detectionsResponse.json();
    const serializedDetections = JSON.stringify(detectionsBody);
    const serializedAudit = JSON.stringify(auditService.list());
    const storedDetections = await jobRepository.getDetectedEntitiesByDocumentId(documentId);
    const storedDocument = await jobRepository.getDocumentById(documentId);

    expect(uploadResponse.statusCode).toBe(201);
    expect(detectionsResponse.statusCode).toBe(200);
    expect(detectionsBody).toMatchObject({
      detections: expect.arrayContaining([
        expect.objectContaining({
          entityType: 'dni',
          previewMasked: '****5678',
        }),
        expect.objectContaining({
          entityType: 'email',
          previewMasked: '********.com',
        }),
        expect.objectContaining({
          entityType: 'credit_card',
          previewMasked: '********1111',
        }),
      ]),
      document: {
        detectionSummary: {
          entityCounts: {
            credit_card: 1,
            dni: 1,
            email: 1,
          },
          riskLevel: 'high',
          rulesVersion: 'local-rules-v1',
          totalEntities: 3,
        },
        id: documentId,
        status: 'needs_review',
      },
    });
    expect(storedDocument?.detectionSummary).toMatchObject({
      riskLevel: 'high',
      totalEntities: 3,
    });
    expect(storedDetections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rawValueHash: expect.stringMatching(/^sha256:/u),
        }),
      ]),
    );
    expect(serializedDetections).not.toContain('rawValueHash');
    expect(serializedDetections).not.toContain('contextWindowHash');
    expect(serializedDetections).not.toContain('12345678');
    expect(serializedDetections).not.toContain('persona@example.com');
    expect(serializedDetections).not.toContain('4111 1111 1111 1111');
    expect(serializedDetections).not.toContain('sensibles.txt');
    expect(serializedAudit).toContain('detection_completed');
    expect(serializedAudit).not.toContain('12345678');
    expect(serializedAudit).not.toContain('persona@example.com');
    expect(serializedAudit).not.toContain('4111 1111 1111 1111');
  });

  it('blocks download until review approval and then serves only anonymized content', async () => {
    const { app, auditService, cookieHeader } = await createUploadTestApp('admin');
    const originalText = 'DNI 12345678. Correo persona@example.com. Tarjeta 4111 1111 1111 1111.';
    const multipart = multipartPayload([
      {
        content: originalText,
        filename: 'aprobacion.txt',
        mimeType: 'text/plain',
      },
    ]);

    const uploadResponse = await app.inject({
      headers: {
        'content-type': multipart.contentType,
        cookie: cookieHeader,
      },
      method: 'POST',
      payload: multipart.payload,
      url: '/uploads/batch',
    });
    const documentId = uploadResponse.json().documents[0].id as string;
    const blockedDownloadResponse = await app.inject({
      headers: { cookie: cookieHeader },
      method: 'GET',
      url: `/documents/${documentId}/download-anonymized`,
    });
    const approvalResponse = await app.inject({
      headers: { cookie: cookieHeader },
      method: 'POST',
      url: `/review/documents/${documentId}/approve`,
    });
    const downloadResponse = await app.inject({
      headers: { cookie: cookieHeader },
      method: 'GET',
      url: `/documents/${documentId}/download-anonymized`,
    });

    await app.close();

    const serializedAudit = JSON.stringify(auditService.list());

    expect(blockedDownloadResponse.statusCode).toBe(409);
    expect(blockedDownloadResponse.json()).toEqual({ error: 'document_not_approved' });
    expect(approvalResponse.statusCode).toBe(200);
    expect(approvalResponse.json()).toMatchObject({
      document: {
        id: documentId,
        status: 'approved',
      },
    });
    expect(downloadResponse.statusCode).toBe(200);
    expect(downloadResponse.headers['content-type']).toContain('text/plain');
    expect(downloadResponse.headers['content-disposition']).toContain('anonymized-');
    expect(downloadResponse.body).toContain('****5678');
    expect(downloadResponse.body).toContain('********.com');
    expect(downloadResponse.body).toContain('********1111');
    expect(downloadResponse.body).not.toContain('12345678');
    expect(downloadResponse.body).not.toContain('persona@example.com');
    expect(downloadResponse.body).not.toContain('4111 1111 1111 1111');
    expect(downloadResponse.body).not.toContain('aprobacion.txt');
    expect(serializedAudit).toContain('review_approved');
    expect(serializedAudit).toContain('download_anonymized');
    expect(serializedAudit).not.toContain('12345678');
    expect(serializedAudit).not.toContain('persona@example.com');
    expect(serializedAudit).not.toContain('4111 1111 1111 1111');
  });

  it('deletes job files and marks documents as deleted without exposing original names', async () => {
    const { app, auditService, cookieHeader, jobRepository, storageService } =
      await createUploadTestApp('admin');
    const originalText = 'DNI 12345678 para eliminar.';
    const multipart = multipartPayload([
      {
        content: originalText,
        filename: 'eliminar.txt',
        mimeType: 'text/plain',
      },
    ]);

    const uploadResponse = await app.inject({
      headers: {
        'content-type': multipart.contentType,
        cookie: cookieHeader,
      },
      method: 'POST',
      payload: multipart.payload,
      url: '/uploads/batch',
    });
    const jobId = uploadResponse.json().job.id as string;
    const documentsBeforeDelete = await jobRepository.getDocumentsByJobId(jobId);
    const originalStorageKey = documentsBeforeDelete[0]?.originalStorageKey;
    const anonymizedStorageKey = documentsBeforeDelete[0]?.anonymizedStorageKey;
    const deleteResponse = await app.inject({
      headers: { cookie: cookieHeader },
      method: 'DELETE',
      url: `/jobs/${jobId}`,
    });
    const deletedJob = await jobRepository.getJobById(jobId);
    const deletedDocuments = await jobRepository.getDocumentsByJobId(jobId);

    await app.close();

    const serializedDelete = JSON.stringify(deleteResponse.json());
    const serializedAudit = JSON.stringify(auditService.list());

    expect(deleteResponse.statusCode).toBe(200);
    expect(deleteResponse.json()).toMatchObject({
      deletedDocuments: 1,
      job: {
        id: jobId,
        status: 'deleted',
      },
    });
    expect(deletedJob?.status).toBe('deleted');
    expect(deletedDocuments[0]?.status).toBe('deleted');
    await expect(storageService.read(originalStorageKey ?? '')).rejects.toThrow();
    await expect(storageService.read(anonymizedStorageKey ?? '')).rejects.toThrow();
    expect(serializedDelete).not.toContain('eliminar.txt');
    expect(serializedDelete).not.toContain(originalText);
    expect(serializedAudit).toContain('deletion_requested');
    expect(serializedAudit).toContain('deletion_completed');
    expect(serializedAudit).not.toContain('eliminar.txt');
    expect(serializedAudit).not.toContain(originalText);
  });

  it('allows the uploader to read job status without exposing original text', async () => {
    const { app, cookieHeader } = await createUploadTestApp();
    const originalText = 'Contenido reservado para extraccion local.';
    const multipart = multipartPayload([
      {
        content: originalText,
        filename: 'estado.txt',
        mimeType: 'text/plain',
      },
    ]);

    const uploadResponse = await app.inject({
      headers: {
        'content-type': multipart.contentType,
        cookie: cookieHeader,
      },
      method: 'POST',
      payload: multipart.payload,
      url: '/uploads/batch',
    });
    const jobId = uploadResponse.json().job.id as string;
    const jobResponse = await app.inject({
      headers: {
        cookie: cookieHeader,
      },
      method: 'GET',
      url: `/jobs/${jobId}`,
    });

    await app.close();

    const serializedBody = JSON.stringify(jobResponse.json());

    expect(jobResponse.statusCode).toBe(200);
    expect(jobResponse.json()).toMatchObject({
      documents: [
        {
          detectionSummary: {
            riskLevel: 'low',
            totalEntities: 0,
          },
          status: 'needs_review',
          validationSummary: {
            anonymization: {
              outputMimeType: 'text/plain',
              replacementsApplied: 0,
            },
            extraction: {
              extractedTextHash: expect.stringMatching(/^sha256:/u),
              extractedTextLength: originalText.length,
            },
          },
        },
      ],
      job: {
        id: jobId,
        processedFiles: 1,
        status: 'needs_review',
      },
    });
    expect(serializedBody).not.toContain(originalText);
    expect(serializedBody).not.toContain('estado.txt');
    expect(serializedBody).not.toContain('tmp-storage');
  });

  it('marks a document as failed when local extraction cannot read embedded text', async () => {
    const { app, auditService, cookieHeader } = await createUploadTestApp();
    const invalidPdfText = '%PDF-1.7\nthis is not a real pdf';
    const multipart = multipartPayload([
      {
        content: invalidPdfText,
        filename: 'fallido.pdf',
        mimeType: 'application/pdf',
      },
    ]);

    const response = await app.inject({
      headers: {
        'content-type': multipart.contentType,
        cookie: cookieHeader,
      },
      method: 'POST',
      payload: multipart.payload,
      url: '/uploads/batch',
    });

    await app.close();

    const serializedAudit = JSON.stringify(auditService.list());

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      documents: [
        {
          mimeType: 'application/pdf',
          status: 'failed',
        },
      ],
      job: {
        status: 'failed',
        totalFiles: 1,
      },
    });
    expect(serializedAudit).toContain('local_text_extraction_failed');
    expect(serializedAudit).not.toContain(invalidPdfText);
    expect(serializedAudit).not.toContain('fallido.pdf');
  });

  it('rejects a dangerous extension', async () => {
    const { app, auditService, cookieHeader } = await createUploadTestApp();
    const multipart = multipartPayload([
      {
        content: 'not allowed',
        filename: 'payload.exe',
        mimeType: 'application/x-msdownload',
      },
    ]);

    const response = await app.inject({
      headers: {
        'content-type': multipart.contentType,
        cookie: cookieHeader,
      },
      method: 'POST',
      payload: multipart.payload,
      url: '/uploads/batch',
    });

    await app.close();

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'unsupported_extension' });
    expect(JSON.stringify(auditService.list())).not.toContain('payload.exe');
    expect(auditService.list()[0]).toEqual(
      expect.objectContaining({
        action: 'upload_rejected',
        result: 'blocked',
      }),
    );
  });

  it('rejects a MIME type inconsistent with extension and content', async () => {
    const { app, cookieHeader } = await createUploadTestApp();
    const multipart = multipartPayload([
      {
        content: '%PDF-1.7\n',
        filename: 'documento.pdf',
        mimeType: 'text/plain',
      },
    ]);

    const response = await app.inject({
      headers: {
        'content-type': multipart.contentType,
        cookie: cookieHeader,
      },
      method: 'POST',
      payload: multipart.payload,
      url: '/uploads/batch',
    });

    await app.close();

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'mime_mismatch' });
  });

  it('rejects path traversal filenames', async () => {
    const { app, auditService, cookieHeader } = await createUploadTestApp();
    const multipart = multipartPayload([
      {
        content: 'safe text',
        filename: '..%2Fsecret.txt',
        mimeType: 'text/plain',
      },
    ]);

    const response = await app.inject({
      headers: {
        'content-type': multipart.contentType,
        cookie: cookieHeader,
      },
      method: 'POST',
      payload: multipart.payload,
      url: '/uploads/batch',
    });

    await app.close();

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'unsafe_file_name' });
    expect(JSON.stringify(auditService.list())).not.toContain('secret.txt');
  });

  it('blocks reviewers from uploading documents', async () => {
    const { app, cookieHeader } = await createUploadTestApp('reviewer');
    const multipart = multipartPayload([
      {
        content: 'safe text',
        filename: 'review.txt',
        mimeType: 'text/plain',
      },
    ]);

    const response = await app.inject({
      headers: {
        'content-type': multipart.contentType,
        cookie: cookieHeader,
      },
      method: 'POST',
      payload: multipart.payload,
      url: '/uploads/batch',
    });

    await app.close();

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'insufficient_role' });
  });
});

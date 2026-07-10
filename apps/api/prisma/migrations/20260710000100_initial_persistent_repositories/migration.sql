CREATE TYPE "UserRole" AS ENUM ('admin', 'reviewer', 'operator');
CREATE TYPE "JobStatus" AS ENUM (
  'uploaded',
  'queued',
  'processing',
  'needs_review',
  'approved',
  'rejected',
  'completed',
  'failed',
  'deleted'
);
CREATE TYPE "DocumentStatus" AS ENUM (
  'uploaded',
  'extracting_text',
  'detecting_entities',
  'anonymizing',
  'needs_review',
  'approved',
  'rejected',
  'completed',
  'failed',
  'deleted'
);
CREATE TYPE "EntityType" AS ENUM (
  'person_name',
  'dni',
  'passport',
  'foreigner_card',
  'ruc',
  'email',
  'phone',
  'address',
  'bank_account',
  'credit_card',
  'health_data',
  'biometric_data',
  'minor_data',
  'location_data',
  'license_plate',
  'ip_address',
  'url',
  'case_number',
  'signature',
  'other'
);
CREATE TYPE "EntityCategory" AS ENUM (
  'personal_data',
  'sensitive_data',
  'confidential_data',
  'identifier'
);
CREATE TYPE "ReplacementType" AS ENUM ('redact', 'mask', 'pseudonymize', 'remove');
CREATE TYPE "RiskLevel" AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE "AuditAction" AS ENUM (
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
  'security_event'
);
CREATE TYPE "AuditResult" AS ENUM ('success', 'failure', 'blocked');

CREATE TABLE "User" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "role" "UserRole" NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Job" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "createdByUserId" TEXT NOT NULL,
  "status" "JobStatus" NOT NULL,
  "totalFiles" INTEGER NOT NULL,
  "processedFiles" INTEGER NOT NULL DEFAULT 0,
  "failedFiles" INTEGER NOT NULL DEFAULT 0,
  "riskLevel" "RiskLevel" NOT NULL DEFAULT 'low',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3),
  CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Document" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "jobId" TEXT NOT NULL,
  "originalFileNameHash" TEXT NOT NULL,
  "originalMimeType" TEXT NOT NULL,
  "fileSizeBytes" INTEGER NOT NULL,
  "status" "DocumentStatus" NOT NULL,
  "originalStorageKey" TEXT,
  "anonymizedStorageKey" TEXT,
  "contentHash" TEXT,
  "anonymizedContentHash" TEXT,
  "detectionSummary" JSONB,
  "validationSummary" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3),
  CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DetectedEntity" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "documentId" TEXT NOT NULL,
  "entityType" "EntityType" NOT NULL,
  "category" "EntityCategory" NOT NULL,
  "startOffset" INTEGER,
  "endOffset" INTEGER,
  "confidence" DOUBLE PRECISION NOT NULL,
  "replacementType" "ReplacementType" NOT NULL,
  "previewMasked" TEXT NOT NULL,
  "rawValueHash" TEXT NOT NULL,
  "ruleId" TEXT,
  "contextWindowHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DetectedEntity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AnonymizationRule" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "description" TEXT,
  "entityType" "EntityType" NOT NULL,
  "replacementType" "ReplacementType" NOT NULL,
  "pattern" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AnonymizationRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditEvent" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "actorUserId" TEXT,
  "action" "AuditAction" NOT NULL,
  "resourceType" TEXT NOT NULL,
  "resourceId" TEXT,
  "result" "AuditResult" NOT NULL,
  "metadata" JSONB,
  "ipHash" TEXT,
  "userAgentHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "Job_createdByUserId_idx" ON "Job"("createdByUserId");
CREATE INDEX "Job_expiresAt_idx" ON "Job"("expiresAt");
CREATE INDEX "Job_status_idx" ON "Job"("status");
CREATE INDEX "Document_jobId_idx" ON "Document"("jobId");
CREATE INDEX "Document_expiresAt_idx" ON "Document"("expiresAt");
CREATE INDEX "Document_status_idx" ON "Document"("status");
CREATE INDEX "DetectedEntity_documentId_idx" ON "DetectedEntity"("documentId");
CREATE INDEX "AuditEvent_actorUserId_idx" ON "AuditEvent"("actorUserId");
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");
CREATE INDEX "AuditEvent_resourceType_resourceId_idx" ON "AuditEvent"("resourceType", "resourceId");

ALTER TABLE "Job"
  ADD CONSTRAINT "Job_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Document"
  ADD CONSTRAINT "Document_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DetectedEntity"
  ADD CONSTRAINT "DetectedEntity_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AuditEvent"
  ADD CONSTRAINT "AuditEvent_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

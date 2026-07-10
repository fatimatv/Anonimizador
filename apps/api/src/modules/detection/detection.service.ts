import {
  detectSensitiveEntities,
  RULES_ENGINE_VERSION,
  type DetectionEngineOptions,
  type DetectionEngineResult,
} from '@document-anonymizer/rules-engine';

export interface DetectionServiceResult extends DetectionEngineResult {
  rulesVersion: string;
}

export class DetectionService {
  detect(text: string): DetectionServiceResult {
    const hashSecret = resolveDetectionHashSecret();
    const detectionOptions: DetectionEngineOptions = hashSecret ? { hashSecret } : {};
    const result = detectSensitiveEntities(text, detectionOptions);

    return {
      ...result,
      rulesVersion: RULES_ENGINE_VERSION,
    };
  }
}

function resolveDetectionHashSecret(): string | undefined {
  const configuredSecret = process.env.DETECTION_HASH_SECRET ?? process.env.AUDIT_HASH_SECRET;

  if (configuredSecret) {
    return configuredSecret;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('DETECTION_HASH_SECRET or AUDIT_HASH_SECRET is required in production');
  }

  return process.env.SESSION_SECRET;
}

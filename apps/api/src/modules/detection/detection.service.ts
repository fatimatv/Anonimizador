import {
  detectSensitiveEntities,
  RULES_ENGINE_VERSION,
  type DetectionEngineResult,
} from '@document-anonymizer/rules-engine';

export interface DetectionServiceResult extends DetectionEngineResult {
  rulesVersion: string;
}

export class DetectionService {
  detect(text: string): DetectionServiceResult {
    const result = detectSensitiveEntities(text);

    return {
      ...result,
      rulesVersion: RULES_ENGINE_VERSION,
    };
  }
}

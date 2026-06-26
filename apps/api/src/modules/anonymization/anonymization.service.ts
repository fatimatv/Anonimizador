import {
  anonymizeText,
  type AnonymizationResult,
  type DetectionResult,
} from '@document-anonymizer/rules-engine';

export class AnonymizationService {
  anonymize(input: { detections: readonly DetectionResult[]; text: string }): AnonymizationResult {
    return anonymizeText(input);
  }
}

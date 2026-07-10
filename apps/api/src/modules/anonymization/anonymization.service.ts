import {
  anonymizeText,
  type AnonymizationOptions,
  type AnonymizationResult,
  type DetectionResult,
} from '@document-anonymizer/rules-engine';

export class AnonymizationService {
  constructor(private readonly options: AnonymizationOptions = resolveAnonymizationOptions()) {}

  anonymize(input: { detections: readonly DetectionResult[]; text: string }): AnonymizationResult {
    return anonymizeText({
      ...input,
      options: this.options,
    });
  }
}

function resolveAnonymizationOptions(): AnonymizationOptions {
  const maskingPolicy = process.env.ANONYMIZATION_MASKING_POLICY;

  return {
    maskingPolicy: maskingPolicy === 'strict' ? 'strict' : 'balanced',
  };
}

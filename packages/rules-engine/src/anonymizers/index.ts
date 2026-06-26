import type { DetectionResult, EntityType, ReplacementType } from '../types/index.js';

export const ANONYMIZATION_ENGINE_VERSION = 'local-anonymizer-v1';

export interface AnonymizationReplacement {
  endOffset: number;
  entityType: EntityType;
  replacementLength: number;
  replacementType: ReplacementType;
  ruleId: string | null;
  startOffset: number;
}

export interface AnonymizationSummary {
  anonymizedTextLength: number;
  originalTextLength: number;
  replacementsApplied: number;
  replacementsByType: Partial<Record<EntityType, number>>;
  rulesVersion: string;
}

export interface AnonymizationResult {
  anonymizedText: string;
  replacements: AnonymizationReplacement[];
  summary: AnonymizationSummary;
}

export function anonymizeText(input: {
  detections: readonly DetectionResult[];
  text: string;
}): AnonymizationResult {
  const detections = resolveOverlaps(input.detections).filter((detection) =>
    hasValidOffsets(detection, input.text),
  );
  const pseudonymState = new Map<string, string>();
  const replacements = detections.map((detection) => {
    const replacement = replacementFor(detection, pseudonymState);

    return {
      detection,
      replacement,
    };
  });
  const anonymizedText = applyReplacements(input.text, replacements);

  return {
    anonymizedText,
    replacements: replacements.map(({ detection, replacement }) => ({
      endOffset: detection.endOffset,
      entityType: detection.entityType,
      replacementLength: replacement.length,
      replacementType: detection.replacementType,
      ruleId: detection.ruleId ?? null,
      startOffset: detection.startOffset,
    })),
    summary: {
      anonymizedTextLength: anonymizedText.length,
      originalTextLength: input.text.length,
      replacementsApplied: replacements.length,
      replacementsByType: summarizeReplacements(detections),
      rulesVersion: ANONYMIZATION_ENGINE_VERSION,
    },
  };
}

function applyReplacements(
  text: string,
  replacements: readonly { detection: DetectionResult; replacement: string }[],
): string {
  return [...replacements]
    .sort((left, right) => right.detection.startOffset - left.detection.startOffset)
    .reduce((currentText, { detection, replacement }) => {
      return `${currentText.slice(0, detection.startOffset)}${replacement}${currentText.slice(
        detection.endOffset,
      )}`;
    }, text);
}

function replacementFor(detection: DetectionResult, pseudonymState: Map<string, string>): string {
  if (detection.replacementType === 'remove') {
    return '';
  }

  if (detection.replacementType === 'pseudonymize') {
    const key = `${detection.entityType}:${detection.rawValueHash}`;
    const existing = pseudonymState.get(key);

    if (existing) {
      return existing;
    }

    const pseudonym = `${detection.entityType.toUpperCase()}_${String(
      pseudonymState.size + 1,
    ).padStart(3, '0')}`;
    pseudonymState.set(key, pseudonym);

    return pseudonym;
  }

  return detection.previewMasked;
}

function resolveOverlaps(detections: readonly DetectionResult[]): DetectionResult[] {
  const sorted = [...detections].sort((left, right) => {
    if (left.startOffset !== right.startOffset) {
      return left.startOffset - right.startOffset;
    }

    return protectionScore(right) - protectionScore(left);
  });
  const accepted: DetectionResult[] = [];

  for (const detection of sorted) {
    const overlapIndex = accepted.findIndex((candidate) => overlaps(candidate, detection));

    if (overlapIndex === -1) {
      accepted.push(detection);
      continue;
    }

    const existing = accepted[overlapIndex];

    if (existing && protectionScore(detection) > protectionScore(existing)) {
      accepted[overlapIndex] = detection;
    }
  }

  return accepted.sort((left, right) => left.startOffset - right.startOffset);
}

function hasValidOffsets(detection: DetectionResult, text: string): boolean {
  return (
    detection.startOffset >= 0 &&
    detection.endOffset > detection.startOffset &&
    detection.endOffset <= text.length
  );
}

function overlaps(left: DetectionResult, right: DetectionResult): boolean {
  return left.startOffset < right.endOffset && right.startOffset < left.endOffset;
}

function protectionScore(detection: DetectionResult): number {
  const categoryScore = {
    confidential_data: 4,
    identifier: 3,
    personal_data: 1,
    sensitive_data: 5,
  };
  const replacementScore = {
    mask: 1,
    pseudonymize: 2,
    redact: 4,
    remove: 3,
  };

  return categoryScore[detection.category] * 10 + replacementScore[detection.replacementType];
}

function summarizeReplacements(
  detections: readonly DetectionResult[],
): Partial<Record<EntityType, number>> {
  const replacementsByType: Partial<Record<EntityType, number>> = {};

  for (const detection of detections) {
    replacementsByType[detection.entityType] = (replacementsByType[detection.entityType] ?? 0) + 1;
  }

  return replacementsByType;
}

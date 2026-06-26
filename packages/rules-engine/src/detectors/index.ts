import { createHash } from 'node:crypto';
import type {
  DetectionResult,
  EntityCategory,
  EntityType,
  ReplacementType,
  RiskLevel,
} from '../types/index.js';

interface DetectorRule {
  category: EntityCategory;
  confidence: number;
  entityType: EntityType;
  pattern: RegExp;
  replacementType: ReplacementType;
  ruleId: string;
  transformMatch?: (match: RegExpExecArray) => string;
  validate?: (value: string) => boolean;
}

export interface DetectionSummary {
  entityCounts: Partial<Record<EntityType, number>>;
  riskLevel: RiskLevel;
  totalEntities: number;
}

export interface DetectionEngineResult {
  detections: DetectionResult[];
  summary: DetectionSummary;
}

export const RULES_ENGINE_VERSION = 'local-rules-v1';

const dictionaryRules: DetectorRule[] = [
  dictionaryRule('health_data', 'sensitive_data', 'redact', 'health-data-dictionary', [
    'diagnostico',
    'diagnóstico',
    'historia clinica',
    'historia clínica',
    'vih',
    'cancer',
    'cáncer',
    'tratamiento medico',
    'tratamiento médico',
  ]),
  dictionaryRule('biometric_data', 'sensitive_data', 'redact', 'biometric-data-dictionary', [
    'huella dactilar',
    'iris',
    'biometrico',
    'biométrico',
    'reconocimiento facial',
  ]),
  dictionaryRule('minor_data', 'sensitive_data', 'redact', 'minor-data-context', [
    'menor de edad',
    'niño',
    'niña',
    'adolescente',
  ]),
];

const regexRules: DetectorRule[] = [
  {
    category: 'identifier',
    confidence: 0.98,
    entityType: 'email',
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu,
    replacementType: 'mask',
    ruleId: 'email-regex-v1',
  },
  {
    category: 'identifier',
    confidence: 0.96,
    entityType: 'ruc',
    pattern: /\b(?:10|20)\d{9}\b/gu,
    replacementType: 'mask',
    ruleId: 'peru-ruc-regex-v1',
  },
  {
    category: 'identifier',
    confidence: 0.9,
    entityType: 'dni',
    pattern: /\b\d{8}\b/gu,
    replacementType: 'mask',
    ruleId: 'peru-dni-regex-v1',
  },
  {
    category: 'identifier',
    confidence: 0.94,
    entityType: 'credit_card',
    pattern: /\b(?:\d[ -]?){13,19}\b/gu,
    replacementType: 'mask',
    ruleId: 'credit-card-luhn-v1',
    transformMatch: (match) => match[0].replace(/[ -]/gu, ''),
    validate: isLikelyCreditCard,
  },
  {
    category: 'identifier',
    confidence: 0.9,
    entityType: 'ip_address',
    pattern:
      /\b(?:(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\b/gu,
    replacementType: 'mask',
    ruleId: 'ipv4-regex-v1',
  },
  {
    category: 'confidential_data',
    confidence: 0.88,
    entityType: 'url',
    pattern: /\bhttps?:\/\/[^\s<>"']+/giu,
    replacementType: 'redact',
    ruleId: 'url-regex-v1',
  },
  {
    category: 'identifier',
    confidence: 0.86,
    entityType: 'phone',
    pattern: /(?:\+?51[\s-]?)?\b9\d{2}[\s-]?\d{3}[\s-]?\d{3}\b/gu,
    replacementType: 'mask',
    ruleId: 'peru-mobile-phone-regex-v1',
  },
  {
    category: 'identifier',
    confidence: 0.84,
    entityType: 'foreigner_card',
    pattern: /\b(?:ce|carn[eé]\s+de\s+extranjer[ií]a)[:\s-]*(\d{9,12})\b/giu,
    replacementType: 'mask',
    ruleId: 'foreigner-card-context-v1',
    transformMatch: (match) => match[1] ?? match[0],
  },
  {
    category: 'identifier',
    confidence: 0.82,
    entityType: 'passport',
    pattern: /\b(?:pasaporte|passport)[:\s-]*([A-Z0-9]{6,12})\b/giu,
    replacementType: 'mask',
    ruleId: 'passport-context-v1',
    transformMatch: (match) => match[1] ?? match[0],
  },
  {
    category: 'confidential_data',
    confidence: 0.82,
    entityType: 'bank_account',
    pattern: /\b(?:cci|cuenta(?:\s+bancaria)?)[:\s-]*(\d{10,20})\b/giu,
    replacementType: 'mask',
    ruleId: 'bank-account-context-v1',
    transformMatch: (match) => match[1] ?? match[0],
  },
  {
    category: 'personal_data',
    confidence: 0.78,
    entityType: 'address',
    pattern:
      /\b(?:av\.?|avenida|calle|jr\.?|jir[oó]n|pasaje|mz\.?|manzana)\s+[A-ZÁÉÍÓÚÑ0-9][^\n,;.]{3,80}/giu,
    replacementType: 'redact',
    ruleId: 'address-context-v1',
  },
  {
    category: 'identifier',
    confidence: 0.76,
    entityType: 'license_plate',
    pattern: /\b[A-Z0-9]{3}-[A-Z0-9]{3}\b/giu,
    replacementType: 'mask',
    ruleId: 'license-plate-regex-v1',
  },
  {
    category: 'confidential_data',
    confidence: 0.8,
    entityType: 'case_number',
    pattern: /\b(?:expediente|caso)[:\s-]*(\d{3,8}[-/]\d{2,4})\b/giu,
    replacementType: 'mask',
    ruleId: 'case-number-context-v1',
    transformMatch: (match) => match[1] ?? match[0],
  },
  {
    category: 'confidential_data',
    confidence: 0.72,
    entityType: 'signature',
    pattern: /\b(?:firma|firmado\s+por)[:\s-]+[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑa-záéíóúñ\s]{3,60}/giu,
    replacementType: 'redact',
    ruleId: 'signature-context-v1',
  },
  {
    category: 'personal_data',
    confidence: 0.72,
    entityType: 'location_data',
    pattern: /\b(?:ubicado\s+en|domicilio\s+en|reside\s+en)\s+[A-ZÁÉÍÓÚÑ][^\n,;.]{3,80}/giu,
    replacementType: 'redact',
    ruleId: 'location-context-v1',
  },
  {
    category: 'personal_data',
    confidence: 0.7,
    entityType: 'person_name',
    pattern:
      /\b(?:sr\.?|sra\.?|señor|señora|nombre)[:\s]+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){1,3})\b/giu,
    replacementType: 'pseudonymize',
    ruleId: 'person-name-context-v1',
    transformMatch: (match) => match[1] ?? match[0],
  },
];

export function detectSensitiveEntities(text: string): DetectionEngineResult {
  const detections = resolveOverlaps([
    ...runRules(text, regexRules),
    ...runRules(text, dictionaryRules),
  ]);

  return {
    detections,
    summary: summarizeDetections(detections),
  };
}

export function summarizeDetections(detections: readonly DetectionResult[]): DetectionSummary {
  const entityCounts: Partial<Record<EntityType, number>> = {};

  for (const detection of detections) {
    entityCounts[detection.entityType] = (entityCounts[detection.entityType] ?? 0) + 1;
  }

  return {
    entityCounts,
    riskLevel: calculateRiskLevel(detections),
    totalEntities: detections.length,
  };
}

function runRules(text: string, rules: readonly DetectorRule[]): DetectionResult[] {
  const detections: DetectionResult[] = [];

  for (const rule of rules) {
    const pattern = cloneGlobalRegex(rule.pattern);
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(text)) !== null) {
      const rawValue = rule.transformMatch?.(match) ?? match[0];

      if (rawValue.length === 0 || rule.validate?.(rawValue) === false) {
        continue;
      }

      const offsets = resolveOffsets(match, rawValue);
      const contextWindow = text.slice(
        Math.max(0, offsets.startOffset - 24),
        offsets.endOffset + 24,
      );

      detections.push({
        category: rule.category,
        confidence: rule.confidence,
        contextWindowHash: hashValue(contextWindow),
        endOffset: offsets.endOffset,
        entityType: rule.entityType,
        previewMasked: maskPreview(rawValue, rule.replacementType, rule.entityType),
        rawValueHash: hashValue(rawValue),
        replacementType: rule.replacementType,
        ruleId: rule.ruleId,
        startOffset: offsets.startOffset,
      });
    }
  }

  return detections;
}

function resolveOffsets(
  match: RegExpExecArray,
  rawValue: string,
): { endOffset: number; startOffset: number } {
  const matchedText = match[0];
  const relativeOffset = matchedText.indexOf(rawValue);

  if (relativeOffset === -1) {
    return {
      endOffset: match.index + matchedText.length,
      startOffset: match.index,
    };
  }

  const startOffset = match.index + relativeOffset;

  return {
    endOffset: startOffset + rawValue.length,
    startOffset,
  };
}

function resolveOverlaps(detections: DetectionResult[]): DetectionResult[] {
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

function overlaps(left: DetectionResult, right: DetectionResult): boolean {
  return left.startOffset < right.endOffset && right.startOffset < left.endOffset;
}

function protectionScore(detection: DetectionResult): number {
  const categoryScore: Record<EntityCategory, number> = {
    confidential_data: 4,
    identifier: 3,
    personal_data: 1,
    sensitive_data: 5,
  };
  const replacementScore: Record<ReplacementType, number> = {
    mask: 1,
    pseudonymize: 2,
    redact: 4,
    remove: 3,
  };

  return categoryScore[detection.category] * 10 + replacementScore[detection.replacementType];
}

function calculateRiskLevel(detections: readonly DetectionResult[]): RiskLevel {
  if (detections.some((detection) => detection.category === 'sensitive_data')) {
    return 'critical';
  }

  if (detections.some((detection) => detection.entityType === 'credit_card')) {
    return 'high';
  }

  if (detections.length >= 5) {
    return 'high';
  }

  if (detections.length > 0) {
    return 'medium';
  }

  return 'low';
}

function maskPreview(
  value: string,
  replacementType: ReplacementType,
  entityType: EntityType,
): string {
  if (replacementType === 'redact') {
    return `[${entityType.toUpperCase()} REDACTADO]`;
  }

  if (replacementType === 'pseudonymize') {
    return `${entityType.toUpperCase()}_001`;
  }

  const visibleSuffix = value.replace(/\s/gu, '').slice(-4);

  return `${'*'.repeat(Math.max(4, Math.min(8, value.length - visibleSuffix.length)))}${visibleSuffix}`;
}

function hashValue(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function cloneGlobalRegex(pattern: RegExp): RegExp {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;

  return new RegExp(pattern.source, flags);
}

function dictionaryRule(
  entityType: EntityType,
  category: EntityCategory,
  replacementType: ReplacementType,
  ruleId: string,
  terms: readonly string[],
): DetectorRule {
  return {
    category,
    confidence: 0.74,
    entityType,
    pattern: new RegExp(`\\b(?:${terms.map(escapeRegex).join('|')})\\b`, 'giu'),
    replacementType,
    ruleId,
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function isLikelyCreditCard(value: string): boolean {
  if (!/^\d{13,19}$/u.test(value)) {
    return false;
  }

  let sum = 0;
  let shouldDouble = false;

  for (let index = value.length - 1; index >= 0; index -= 1) {
    let digit = Number(value[index]);

    if (shouldDouble) {
      digit *= 2;

      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return sum % 10 === 0;
}

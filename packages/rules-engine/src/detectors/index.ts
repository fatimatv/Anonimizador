import { createHash, createHmac } from 'node:crypto';
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
  validate?: (value: string, match: RegExpExecArray, text: string) => boolean;
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

export interface DetectionEngineOptions {
  hashSecret?: string;
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
    'enfermedad',
    'discapacidad',
    'salud mental',
    'medicacion',
    'medicación',
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
    'menor',
    'infante',
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
    validate: isLikelyPeruRuc,
  },
  {
    category: 'identifier',
    confidence: 0.94,
    entityType: 'dni',
    pattern:
      /\b(?:dni|documento\s+nacional\s+de\s+identidad|doc\.?\s+identidad)[:.\s-]*(\d{8})\b/giu,
    replacementType: 'mask',
    ruleId: 'peru-dni-context-v2',
    transformMatch: (match) => match[1] ?? match[0],
    validate: isLikelyPeruDni,
  },
  {
    category: 'identifier',
    confidence: 0.68,
    entityType: 'dni',
    pattern: /\b\d{8}\b/gu,
    replacementType: 'mask',
    ruleId: 'peru-dni-regex-v2',
    validate: isLikelyPeruDni,
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
    entityType: 'phone',
    pattern:
      /\b(?:tel[eé]fono|telefono|telf\.?|tel\.?|celular|m[oó]vil|movil|fax)[:.\s-]*(\+?(?:\d[\s().-]?){5,12}\d)\b/giu,
    replacementType: 'mask',
    ruleId: 'phone-context-regex-v1',
    transformMatch: (match) => match[1]?.trim() ?? match[0],
    validate: isLikelyPhoneNumber,
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
    validate: isLikelyBankAccount,
  },
  {
    category: 'confidential_data',
    confidence: 0.88,
    entityType: 'bank_account',
    pattern: /\b(?:cci|c[oó]digo\s+de\s+cuenta\s+interbancaria)[:\s-]*(\d{20})\b/giu,
    replacementType: 'mask',
    ruleId: 'peru-cci-context-v1',
    transformMatch: (match) => match[1] ?? match[0],
    validate: isLikelyBankAccount,
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
    pattern:
      /\b(?:placa|matr[ií]cula(?:\s+vehicular)?|veh[ií]culo\s+placa)[:\s-]*([A-Z0-9]{3}-[A-Z0-9]{3})\b/giu,
    replacementType: 'mask',
    ruleId: 'license-plate-regex-v1',
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
    category: 'confidential_data',
    confidence: 0.88,
    entityType: 'case_number',
    pattern:
      /\b(?:expediente|exp\.?|caso|resoluci[oó]n|res\.?|procedimiento|tr[aá]mite|carta\s+n[°º.]?)[:\s]*(?:n[°º.]?\s*)?([A-Z0-9][A-Z0-9./-]{4,40})\b/giu,
    replacementType: 'pseudonymize',
    ruleId: 'legal-case-number-context-v1',
    transformMatch: (match) => match[1] ?? match[0],
    validate: isLikelyCaseNumber,
  },
  {
    category: 'personal_data',
    confidence: 0.82,
    entityType: 'person_name',
    pattern:
      /\b(?:agraviado|agraviada|apoderado|apoderada|administrado|administrada|consumidor|consumidora|denunciante|denunciado|denunciada|demandante|demandado|demandada|imputado|imputada|investigado|investigada|quejoso|quejosa|reclamante|solicitante|titular|representante|testigo)[:\s.-]+([A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑa-záéíóúüñ'-]+(?:[ \t]+[A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑa-záéíóúüñ'-]+){1,5})\b/giu,
    replacementType: 'redact',
    ruleId: 'legal-person-name-context-v1',
    transformMatch: (match) => match[1] ?? match[0],
    validate: isLikelyPersonName,
  },
  {
    category: 'personal_data',
    confidence: 0.74,
    entityType: 'person_name',
    pattern:
      /\b(?:sr\.?|sra\.?|señor|señora|nombre|nombres|apellidos?)[:\s]+([A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑa-záéíóúüñ'-]+(?:[ \t]+[A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑa-záéíóúüñ'-]+){1,4})\b/giu,
    replacementType: 'redact',
    ruleId: 'person-name-context-v1',
    transformMatch: (match) => match[1] ?? match[0],
    validate: isLikelyPersonName,
  },
  {
    category: 'confidential_data',
    confidence: 0.76,
    entityType: 'organization',
    pattern:
      /\b(?:empresa|raz[oó]n\s+social|proveedor|entidad|empleador|contratista|instituci[oó]n|persona\s+jur[ií]dica)[:\s.-]+([A-ZÁÉÍÓÚÜÑ0-9][A-ZÁÉÍÓÚÜÑa-záéíóúüñ0-9&'.-]+(?:[ \t]+[A-ZÁÉÍÓÚÜÑ0-9][A-ZÁÉÍÓÚÜÑa-záéíóúüñ0-9&'.-]+){1,8}?)(?=\s+(?:con\s+)?ruc\b|[.;,\n]|$)/giu,
    replacementType: 'pseudonymize',
    ruleId: 'organization-context-v1',
    transformMatch: (match) => match[1] ?? match[0],
    validate: isLikelyOrganization,
  },
];

export function detectSensitiveEntities(
  text: string,
  options: DetectionEngineOptions = {},
): DetectionEngineResult {
  const detections = resolveOverlaps([
    ...runRules(text, regexRules, options),
    ...runRules(text, dictionaryRules, options),
    ...detectLegalNamedEntities(text, options),
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

function runRules(
  text: string,
  rules: readonly DetectorRule[],
  options: DetectionEngineOptions,
): DetectionResult[] {
  const detections: DetectionResult[] = [];

  for (const rule of rules) {
    const pattern = cloneGlobalRegex(rule.pattern);
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(text)) !== null) {
      const rawValue = rule.transformMatch?.(match) ?? match[0];

      if (rawValue.length === 0 || rule.validate?.(rawValue, match, text) === false) {
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
        contextWindowHash: hashValue(contextWindow, options.hashSecret),
        endOffset: offsets.endOffset,
        entityType: rule.entityType,
        previewMasked: maskPreview(rawValue, rule.replacementType, rule.entityType),
        rawValueHash: hashValue(rawValue, options.hashSecret),
        replacementType: rule.replacementType,
        ruleId: rule.ruleId,
        startOffset: offsets.startOffset,
      });
    }
  }

  return detections;
}

function detectLegalNamedEntities(
  text: string,
  options: DetectionEngineOptions,
): DetectionResult[] {
  const detections: DetectionResult[] = [];
  const partyLinePattern =
    /^(?:\s*)(?:agraviado|agraviada|denunciante|denunciado|denunciada|demandante|demandado|demandada|imputado|imputada|quejoso|quejosa|representante|testigo)\s*[:.-]\s*([A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ' -]{5,80})$/gimu;
  let match: RegExpExecArray | null;

  while ((match = partyLinePattern.exec(text)) !== null) {
    const rawValue = titleCaseName((match[1] ?? '').trim());

    if (!isLikelyPersonName(rawValue)) {
      continue;
    }

    const offsets = resolveOffsets(match, match[1] ?? match[0]);
    const contextWindow = text.slice(Math.max(0, offsets.startOffset - 24), offsets.endOffset + 24);

    detections.push({
      category: 'personal_data',
      confidence: 0.86,
      contextWindowHash: hashValue(contextWindow, options.hashSecret),
      endOffset: offsets.endOffset,
      entityType: 'person_name',
      previewMasked: '[PERSON_NAME REDACTADO]',
      rawValueHash: hashValue(rawValue, options.hashSecret),
      replacementType: 'redact',
      ruleId: 'legal-party-line-ner-v1',
      startOffset: offsets.startOffset,
    });
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

function hashValue(value: string, secret: string | undefined): string {
  if (secret) {
    return `hmac-sha256:${createHmac('sha256', secret).update(value).digest('hex')}`;
  }

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

function isLikelyPhoneNumber(value: string): boolean {
  const digits = value.replace(/\D/gu, '');

  return digits.length >= 6 && digits.length <= 11;
}

function isLikelyPeruDni(value: string, match?: RegExpExecArray, text?: string): boolean {
  const digits = value.replace(/\D/gu, '');

  if (!/^\d{8}$/u.test(digits) || /^(\d)\1{7}$/u.test(digits)) {
    return false;
  }

  const numeric = Number(digits);

  if (numeric < 1000000) {
    return false;
  }

  if (match && text) {
    const leftContext = text.slice(Math.max(0, match.index - 24), match.index).toLowerCase();

    if (/\b(?:expediente|resoluci[oó]n|caso|ruc|cuenta|cci|partida)\b/u.test(leftContext)) {
      return false;
    }
  }

  return true;
}

function isLikelyPeruRuc(value: string): boolean {
  const digits = value.replace(/\D/gu, '');

  if (!/^(?:10|20)\d{9}$/u.test(digits) || /^(\d)\1{10}$/u.test(digits)) {
    return false;
  }

  const factors = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = factors.reduce((total, factor, index) => total + Number(digits[index]) * factor, 0);
  const remainder = 11 - (sum % 11);
  const checkDigit = remainder === 10 ? 0 : remainder === 11 ? 1 : remainder;

  return checkDigit === Number(digits[10]);
}

function isLikelyBankAccount(value: string): boolean {
  const digits = value.replace(/\D/gu, '');

  return digits.length >= 10 && digits.length <= 20 && !/^(\d)\1+$/u.test(digits);
}

function isLikelyCaseNumber(value: string): boolean {
  const normalized = value.trim();

  return (
    normalized.length >= 5 &&
    /[0-9]/u.test(normalized) &&
    /[-/.]/u.test(normalized) &&
    !/^\d{8}$/u.test(normalized)
  );
}

function isLikelyPersonName(value: string): boolean {
  if (/\d/u.test(value)) {
    return false;
  }

  const normalized = normalizeForRules(value);
  const corporateMarkers = [
    'ASOCIACION',
    'BANCO',
    'COMISION',
    'EMPRESA',
    'EIRL',
    'FINANCIERA',
    'INDECOPI',
    'MUNICIPALIDAD',
    'S A',
    'SA',
    'SAC',
    'S R L',
    'SRL',
    'UNIVERSIDAD',
  ];

  if (corporateMarkers.some((marker) => normalized.includes(marker))) {
    return false;
  }

  const tokens = normalized.split(/\s+/u).filter(Boolean);
  const particles = new Set([
    'DA',
    'DE',
    'DEL',
    'DI',
    'DOS',
    'LA',
    'LAS',
    'LOS',
    'VAN',
    'VON',
    'Y',
  ]);

  return (
    tokens.length >= 2 &&
    tokens.length <= 6 &&
    tokens.every((token) => token.length >= 2 || particles.has(token))
  );
}

function isLikelyOrganization(value: string): boolean {
  const normalized = normalizeForRules(value);

  if (
    isLikelyPersonName(value) &&
    !/\b(?:SAC|SA|SRL|EIRL|BANCO|ASOCIACION|EMPRESA)\b/u.test(normalized)
  ) {
    return false;
  }

  const organizationMarkers = [
    'ASOCIACION',
    'BANCO',
    'CLINICA',
    'COMISION',
    'EIRL',
    'EMPRESA',
    'FINANCIERA',
    'FUNDACION',
    'INSTITUTO',
    'MUNICIPALIDAD',
    'S A',
    'SA',
    'SAC',
    'S R L',
    'SRL',
    'UNIVERSIDAD',
  ];

  return (
    normalized.split(/\s+/u).filter(Boolean).length >= 2 &&
    organizationMarkers.some((marker) => normalized.includes(marker))
  );
}

function titleCaseName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b[\p{L}'-]+/gu, (token) => token.charAt(0).toUpperCase() + token.slice(1));
}

function normalizeForRules(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^A-Z0-9\s]/giu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .toUpperCase();
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

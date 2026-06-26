import { describe, expect, it } from 'vitest';
import { anonymizeText } from '../anonymizers/index.js';
import { detectSensitiveEntities } from '../detectors/index.js';
import type { DetectionResult } from '../types/index.js';

describe('detection result contract', () => {
  it('uses masked previews instead of raw values', () => {
    const result = {
      category: 'identifier',
      confidence: 0.95,
      endOffset: 18,
      entityType: 'dni',
      previewMasked: '****1234',
      rawValueHash: 'sha256:test',
      replacementType: 'mask',
      startOffset: 10,
    } satisfies DetectionResult;

    expect(Object.keys(result)).not.toContain('rawValue');
  });
});

describe('local anonymizer', () => {
  it('applies masked and redacted replacements without returning raw values', () => {
    const text =
      'DNI 12345678 y correo persona@example.com con URL https://example.com/caso y tarjeta 4111 1111 1111 1111.';
    const detectionResult = detectSensitiveEntities(text);
    const result = anonymizeText({
      detections: detectionResult.detections,
      text,
    });

    expect(result.anonymizedText).toContain('****5678');
    expect(result.anonymizedText).toContain('********.com');
    expect(result.anonymizedText).toContain('[URL REDACTADO]');
    expect(result.anonymizedText).toContain('********1111');
    expect(result.anonymizedText).not.toContain('12345678');
    expect(result.anonymizedText).not.toContain('persona@example.com');
    expect(result.anonymizedText).not.toContain('https://example.com/caso');
    expect(result.anonymizedText).not.toContain('4111 1111 1111 1111');
    expect(JSON.stringify(result.replacements)).not.toContain('rawValue');
    expect(result.summary).toMatchObject({
      replacementsApplied: 4,
      rulesVersion: 'local-anonymizer-v1',
    });
  });

  it('keeps pseudonyms consistent for repeated raw hashes', () => {
    const text = 'Maria Lopez firmo. Maria Lopez reviso.';
    const detections: DetectionResult[] = [
      {
        category: 'personal_data',
        confidence: 0.9,
        endOffset: 11,
        entityType: 'person_name',
        previewMasked: 'PERSON_NAME_001',
        rawValueHash: 'sha256:maria-lopez',
        replacementType: 'pseudonymize',
        startOffset: 0,
      },
      {
        category: 'personal_data',
        confidence: 0.9,
        endOffset: 30,
        entityType: 'person_name',
        previewMasked: 'PERSON_NAME_001',
        rawValueHash: 'sha256:maria-lopez',
        replacementType: 'pseudonymize',
        startOffset: 19,
      },
    ];
    const result = anonymizeText({ detections, text });

    expect(result.anonymizedText).toBe('PERSON_NAME_001 firmo. PERSON_NAME_001 reviso.');
  });
});

describe('local detectors', () => {
  it('detects DNI values without exposing raw values', () => {
    const result = detectSensitiveEntities('DNI 12345678 registrado.');
    const dni = result.detections.find((detection) => detection.entityType === 'dni');

    expect(dni).toMatchObject({
      previewMasked: '****5678',
      rawValueHash: expect.stringMatching(/^sha256:/u),
    });
    expect(JSON.stringify(dni)).not.toContain('12345678');
  });

  it('detects RUC values', () => {
    const result = detectSensitiveEntities('RUC 20123456789 activo.');

    expect(result.detections).toEqual([
      expect.objectContaining({
        entityType: 'ruc',
        previewMasked: '*******6789',
      }),
    ]);
  });

  it('detects email values', () => {
    const result = detectSensitiveEntities('Correo: persona@example.com');

    expect(result.detections).toEqual([
      expect.objectContaining({
        entityType: 'email',
        previewMasked: '********.com',
      }),
    ]);
  });

  it('detects mobile phone values', () => {
    const result = detectSensitiveEntities('Telefono 987 654 321');

    expect(result.detections).toEqual([
      expect.objectContaining({
        entityType: 'phone',
      }),
    ]);
  });

  it('detects credit cards only when Luhn is valid', () => {
    const result = detectSensitiveEntities('Tarjeta 4111 1111 1111 1111 no debe verse.');

    expect(result.detections).toEqual([
      expect.objectContaining({
        entityType: 'credit_card',
        previewMasked: '********1111',
      }),
    ]);
  });

  it('detects IP addresses and URLs', () => {
    const result = detectSensitiveEntities('IP 192.168.1.10 y URL https://example.com/caso?id=1');

    expect(result.detections.map((detection) => detection.entityType)).toEqual([
      'ip_address',
      'url',
    ]);
  });

  it('detects passport and foreigner card values by context', () => {
    const result = detectSensitiveEntities('Pasaporte A1234567 y CE 123456789.');

    expect(result.detections.map((detection) => detection.entityType)).toEqual([
      'passport',
      'foreigner_card',
    ]);
  });

  it('detects bank accounts, license plates, case numbers, and signatures', () => {
    const result = detectSensitiveEntities(
      'Cuenta 12345678901234567890, placa ABC-123, expediente 1234-2024. Firma: Maria Lopez',
    );

    expect(result.detections.map((detection) => detection.entityType)).toEqual([
      'bank_account',
      'license_plate',
      'case_number',
      'signature',
    ]);
  });

  it('detects address, location, and person name context', () => {
    const result = detectSensitiveEntities(
      'Nombre: Maria Lopez. Calle Los Sauces 123. Reside en Lima Norte.',
    );

    expect(result.detections.map((detection) => detection.entityType)).toEqual([
      'person_name',
      'address',
      'location_data',
    ]);
  });

  it('detects controlled dictionaries for sensitive data', () => {
    const result = detectSensitiveEntities(
      'Historia clinica con diagnostico de cancer y huella dactilar de menor de edad.',
    );

    expect(result.summary.riskLevel).toBe('critical');
    expect(result.detections.map((detection) => detection.entityType)).toEqual([
      'health_data',
      'health_data',
      'health_data',
      'biometric_data',
      'minor_data',
    ]);
  });

  it('resolves overlaps by keeping the more protective detection', () => {
    const result = detectSensitiveEntities('Cuenta 4111111111111111.');

    expect(result.detections).toEqual([
      expect.objectContaining({
        entityType: 'bank_account',
      }),
    ]);
  });
});

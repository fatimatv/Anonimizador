import { describe, expect, it } from 'vitest';
import { detectSensitiveEntities } from '../detectors/index.js';
import type { EntityType } from '../types/index.js';

interface CorpusCase {
  expectedEntityTypes: EntityType[];
  name: string;
  text: string;
}

const corpus: CorpusCase[] = [
  {
    expectedEntityTypes: ['person_name', 'dni', 'case_number'],
    name: 'legal party with DNI and case number',
    text: 'Denunciante: Maria Elena Torres Vega DNI 12345678. Expediente: 1234-2024/CCO.',
  },
  {
    expectedEntityTypes: ['organization', 'ruc'],
    name: 'provider organization with valid RUC',
    text: 'Proveedor: Banco de Lima SAC con RUC 20100070970.',
  },
  {
    expectedEntityTypes: ['health_data', 'biometric_data', 'minor_data'],
    name: 'special category data',
    text: 'Historia clinica y huella dactilar de menor de edad.',
  },
  {
    expectedEntityTypes: ['address', 'phone', 'email'],
    name: 'contact details',
    text: 'Calle Los Sauces 123. Telefono 987654321. Correo persona@example.com.',
  },
  {
    expectedEntityTypes: [],
    name: 'legal reference without extractable case number',
    text: 'EXPEDIENTE N.º 014-2025/MPP-SIA',
  },
  {
    expectedEntityTypes: [],
    name: 'invalid RUC checksum is ignored',
    text: 'RUC 20123456789 activo.',
  },
];

describe('rules engine evaluation corpus', () => {
  it.each(corpus)('matches expected entity set: $name', ({ expectedEntityTypes, text }) => {
    const result = detectSensitiveEntities(text);

    expect(result.detections.map((detection) => detection.entityType)).toEqual(expectedEntityTypes);
  });
});

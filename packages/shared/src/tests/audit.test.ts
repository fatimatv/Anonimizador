import { describe, expect, it } from 'vitest';
import { assertSafeAuditMetadata } from '../privacy/audit';

describe('audit metadata safety', () => {
  it('accepts aggregate metadata', () => {
    expect(
      assertSafeAuditMetadata({
        entityCounts: {
          dni: 2,
          email: 1,
        },
        riskLevel: 'high',
      }),
    ).toEqual({
      entityCounts: {
        dni: 2,
        email: 1,
      },
      riskLevel: 'high',
    });
  });

  it('rejects keys that suggest document content', () => {
    expect(() =>
      assertSafeAuditMetadata({
        rawValue: '12345678',
      }),
    ).toThrow('Unsafe audit metadata key detected');
  });
});

import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/main.js';

describe('health endpoint', () => {
  it('returns a minimal non-sensitive status payload', async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      service: 'document-anonymizer-api',
      status: 'ok',
    });
  });
});

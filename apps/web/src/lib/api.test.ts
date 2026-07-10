import { describe, expect, it } from 'vitest';
import { ApiError } from './api';

describe('ApiError', () => {
  it('keeps the HTTP status and public error code', () => {
    const error = new ApiError(403, 'insufficient_role');

    expect(error.status).toBe(403);
    expect(error.code).toBe('insufficient_role');
    expect(error.message).toBe('insufficient_role');
  });
});

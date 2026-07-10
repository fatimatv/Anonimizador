import { afterEach, describe, expect, it } from 'vitest';
import { createRedisConnectionOptionsFromEnv } from '../src/modules/processing/processing.queue.js';

const originalRedisUrl = process.env.REDIS_URL;

afterEach(() => {
  if (originalRedisUrl === undefined) {
    delete process.env.REDIS_URL;
  } else {
    process.env.REDIS_URL = originalRedisUrl;
  }
});

describe('processing queue configuration', () => {
  it('parses REDIS_URL for BullMQ connections', () => {
    process.env.REDIS_URL = 'redis://queue-user:secret@redis.internal:6380/2';

    expect(createRedisConnectionOptionsFromEnv()).toMatchObject({
      db: 2,
      host: 'redis.internal',
      maxRetriesPerRequest: null,
      password: 'secret',
      port: 6380,
      username: 'queue-user',
    });
  });

  it('requires REDIS_URL when BullMQ is selected', () => {
    delete process.env.REDIS_URL;

    expect(() => createRedisConnectionOptionsFromEnv()).toThrow('REDIS_URL is required');
  });
});

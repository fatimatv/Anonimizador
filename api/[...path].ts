import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildApp } from '../apps/api/src/main.js';

process.env.SESSION_COOKIE_SECURE ??= 'true';
process.env.TEMP_STORAGE_ROOT ??= '/tmp/anonimizador';

const appPromise = buildApp({ enableRetentionCleanup: false }).then(async (app) => {
  await app.ready();
  return app;
});

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  request.url = stripApiPrefix(request.url);
  const app = await appPromise;

  app.server.emit('request', request, response);
}

function stripApiPrefix(url: string | undefined): string {
  if (!url) {
    return '/';
  }

  const strippedUrl = url.replace(/^\/api(?=\/|$)/u, '');

  return strippedUrl === '' ? '/' : strippedUrl;
}

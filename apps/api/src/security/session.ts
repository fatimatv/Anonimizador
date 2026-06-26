import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { AuthenticatedUser } from '../common/guards/roles.js';

export interface SessionPayload {
  exp: number;
  iat: number;
  role: AuthenticatedUser['role'];
  sid: string;
  sub: string;
}

export interface CreatedSession {
  cookieName: string;
  expiresAt: Date;
  secureCookie: boolean;
  token: string;
}

interface SessionServiceOptions {
  cookieName?: string;
  secureCookie?: boolean;
  secret: string;
  ttlSeconds?: number;
}

export class SessionService {
  readonly cookieName: string;

  private readonly secureCookie: boolean;

  private readonly secret: string;

  private readonly ttlSeconds: number;

  constructor(options: SessionServiceOptions) {
    this.cookieName = options.cookieName ?? 'anonimizador_session';
    this.secureCookie = options.secureCookie ?? false;
    this.secret = options.secret;
    this.ttlSeconds = options.ttlSeconds ?? 900;
  }

  create(user: AuthenticatedUser): CreatedSession {
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAtSeconds = issuedAt + this.ttlSeconds;
    const payload: SessionPayload = {
      exp: expiresAtSeconds,
      iat: issuedAt,
      role: user.role,
      sid: randomUUID(),
      sub: user.id,
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const signature = sign(encodedPayload, this.secret);

    return {
      cookieName: this.cookieName,
      expiresAt: new Date(expiresAtSeconds * 1000),
      secureCookie: this.secureCookie,
      token: `${encodedPayload}.${signature}`,
    };
  }

  verify(token: string): SessionPayload | null {
    const [encodedPayload, signature, extra] = token.split('.');

    if (!encodedPayload || !signature || extra !== undefined) {
      return null;
    }

    const expectedSignature = sign(encodedPayload, this.secret);

    if (!safeEqual(signature, expectedSignature)) {
      return null;
    }

    try {
      const payload = JSON.parse(
        Buffer.from(encodedPayload, 'base64url').toString('utf8'),
      ) as Partial<SessionPayload>;

      if (
        typeof payload.sub !== 'string' ||
        typeof payload.sid !== 'string' ||
        typeof payload.iat !== 'number' ||
        typeof payload.exp !== 'number' ||
        !['admin', 'reviewer', 'operator'].includes(String(payload.role))
      ) {
        return null;
      }

      if (payload.exp <= Math.floor(Date.now() / 1000)) {
        return null;
      }

      return payload as SessionPayload;
    } catch {
      return null;
    }
  }

  isSecureCookieEnabled(): boolean {
    return this.secureCookie;
  }
}

export function readSessionCookie(
  cookieHeader: string | undefined,
  cookieName: string,
): string | null {
  if (!cookieHeader) {
    return null;
  }

  const cookies = cookieHeader.split(';');

  for (const cookie of cookies) {
    const [rawName, ...rawValueParts] = cookie.trim().split('=');

    if (rawName === cookieName) {
      return decodeURIComponent(rawValueParts.join('='));
    }
  }

  return null;
}

export function serializeSessionCookie(session: CreatedSession): string {
  const secure = session.secureCookie ? 'Secure' : '';

  return [
    `${session.cookieName}=${encodeURIComponent(session.token)}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Strict',
    secure,
    `Expires=${session.expiresAt.toUTCString()}`,
  ]
    .filter(Boolean)
    .join('; ');
}

export function clearSessionCookie(cookieName: string): string {
  const secure = process.env.SESSION_COOKIE_SECURE === 'true' ? 'Secure' : '';

  return [
    `${cookieName}=`,
    'HttpOnly',
    'Path=/',
    'SameSite=Strict',
    secure,
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ]
    .filter(Boolean)
    .join('; ');
}

export function createSessionServiceFromEnv(): SessionService {
  const secret = process.env.SESSION_SECRET;

  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET is required in production');
  }

  const options: ConstructorParameters<typeof SessionService>[0] = {
    secret: secret ?? 'development-only-session-secret',
    secureCookie: process.env.SESSION_COOKIE_SECURE === 'true',
    ttlSeconds: Number(process.env.SESSION_TTL_SECONDS ?? 900),
  };

  if (process.env.SESSION_COOKIE_NAME) {
    options.cookieName = process.env.SESSION_COOKIE_NAME;
  }

  return new SessionService(options);
}

function sign(encodedPayload: string, secret: string): string {
  return createHmac('sha256', secret).update(encodedPayload).digest('base64url');
}

function safeEqual(value: string, expected: string): boolean {
  const valueBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);

  return (
    valueBuffer.length === expectedBuffer.length && timingSafeEqual(valueBuffer, expectedBuffer)
  );
}

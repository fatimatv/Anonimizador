import * as argon2 from 'argon2';
import type { OutgoingHttpHeaders } from 'node:http';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/main.js';
import { AuditService } from '../src/modules/audit/audit.service.js';
import { InMemoryUserRepository, type UserRecord } from '../src/modules/users/user.repository.js';
import { SessionService } from '../src/security/session.js';

async function createAppWithUser(options: {
  email?: string;
  lockAfterAttempts?: number;
  password?: string;
  role?: UserRecord['role'];
}) {
  const password = options.password ?? 'correct-password';
  const now = new Date();
  const user: UserRecord = {
    createdAt: now,
    email: options.email ?? 'admin@example.local',
    failedLoginAttempts: 0,
    id: 'user-1',
    isActive: true,
    lockedUntil: null,
    passwordHash: await argon2.hash(password),
    role: options.role ?? 'admin',
    updatedAt: now,
  };
  const auditService = new AuditService('test-audit-secret');
  const repositoryOptions: ConstructorParameters<typeof InMemoryUserRepository>[0] = {
    lockMinutes: 15,
    users: [user],
  };

  if (options.lockAfterAttempts !== undefined) {
    repositoryOptions.lockAfterAttempts = options.lockAfterAttempts;
  }

  const userRepository = new InMemoryUserRepository(repositoryOptions);
  const sessionService = new SessionService({
    cookieName: 'test_session',
    secret: 'test-session-secret',
    ttlSeconds: 300,
  });
  const app = await buildApp({
    auditService,
    sessionService,
    userRepository,
  });

  return {
    app,
    auditService,
    password,
    user,
  };
}

function sessionCookieFrom(responseHeaders: OutgoingHttpHeaders): string {
  const header = responseHeaders['set-cookie'];
  const setCookie = Array.isArray(header) ? header[0] : String(header ?? '');

  if (!setCookie) {
    throw new Error('Expected set-cookie header');
  }

  return setCookie.split(';')[0] ?? '';
}

describe('auth module', () => {
  it('logs in an active user and returns the current session user', async () => {
    const { app, auditService, password, user } = await createAppWithUser({});

    const loginResponse = await app.inject({
      method: 'POST',
      payload: {
        email: 'ADMIN@example.local',
        password,
      },
      url: '/auth/login',
    });

    expect(loginResponse.statusCode).toBe(200);
    expect(String(loginResponse.headers['set-cookie'])).toContain('HttpOnly');
    expect(String(loginResponse.headers['set-cookie'])).toContain('SameSite=Strict');
    expect(loginResponse.json()).toMatchObject({
      user: {
        email: user.email,
        id: user.id,
        role: 'admin',
      },
    });

    const meResponse = await app.inject({
      headers: {
        cookie: sessionCookieFrom(loginResponse.headers),
      },
      method: 'GET',
      url: '/auth/me',
    });

    await app.close();

    expect(meResponse.statusCode).toBe(200);
    expect(meResponse.json()).toMatchObject({
      user: {
        email: user.email,
        id: user.id,
        role: 'admin',
      },
    });
    expect(auditService.list()).toEqual([
      expect.objectContaining({
        action: 'login',
        actorUserId: user.id,
        result: 'success',
      }),
    ]);
  });

  it('creates a temporary public operator session without credentials', async () => {
    const { app, auditService } = await createAppWithUser({});

    const publicResponse = await app.inject({
      method: 'POST',
      url: '/auth/public',
    });

    expect(publicResponse.statusCode).toBe(200);
    expect(String(publicResponse.headers['set-cookie'])).toContain('HttpOnly');
    expect(publicResponse.json()).toMatchObject({
      user: {
        email: 'uso-publico@anonimizador.local',
        id: 'public-access-operator',
        role: 'operator',
      },
    });

    const meResponse = await app.inject({
      headers: {
        cookie: sessionCookieFrom(publicResponse.headers),
      },
      method: 'GET',
      url: '/auth/me',
    });

    await app.close();

    expect(meResponse.statusCode).toBe(200);
    expect(meResponse.json()).toMatchObject({
      user: {
        id: 'public-access-operator',
        role: 'operator',
      },
    });
    expect(auditService.list()).toEqual([
      expect.objectContaining({
        action: 'login',
        actorUserId: 'public-access-operator',
        result: 'success',
      }),
    ]);
  });

  it('rejects invalid credentials without auditing raw email or password', async () => {
    const { app, auditService } = await createAppWithUser({});

    const response = await app.inject({
      method: 'POST',
      payload: {
        email: 'admin@example.local',
        password: 'definitely-wrong',
      },
      url: '/auth/login',
    });

    await app.close();

    const serializedEvents = JSON.stringify(auditService.list());

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'invalid_credentials' });
    expect(serializedEvents).not.toContain('admin@example.local');
    expect(serializedEvents).not.toContain('definitely-wrong');
    expect(auditService.list()[0]).toEqual(
      expect.objectContaining({
        action: 'login',
        result: 'failure',
      }),
    );
  });

  it('temporarily blocks login after repeated failures', async () => {
    const { app, password } = await createAppWithUser({ lockAfterAttempts: 2 });

    await app.inject({
      method: 'POST',
      payload: { email: 'admin@example.local', password: 'wrong-1' },
      url: '/auth/login',
    });
    await app.inject({
      method: 'POST',
      payload: { email: 'admin@example.local', password: 'wrong-2' },
      url: '/auth/login',
    });

    const lockedResponse = await app.inject({
      method: 'POST',
      payload: { email: 'admin@example.local', password },
      url: '/auth/login',
    });

    await app.close();

    expect(lockedResponse.statusCode).toBe(423);
    expect(lockedResponse.json()).toEqual({ error: 'login_temporarily_blocked' });
  });
});

describe('audit route authorization', () => {
  it('allows admins to read non-sensitive audit events', async () => {
    const { app, password } = await createAppWithUser({});

    const loginResponse = await app.inject({
      method: 'POST',
      payload: { email: 'admin@example.local', password },
      url: '/auth/login',
    });
    const auditResponse = await app.inject({
      headers: {
        cookie: sessionCookieFrom(loginResponse.headers),
      },
      method: 'GET',
      url: '/audit-events',
    });

    await app.close();

    expect(auditResponse.statusCode).toBe(200);
    expect(auditResponse.json()).toMatchObject({
      events: [
        {
          action: 'login',
          result: 'success',
        },
      ],
    });
  });

  it('blocks non-admin users from reading audit events', async () => {
    const { app, password } = await createAppWithUser({
      email: 'operator@example.local',
      role: 'operator',
    });

    const loginResponse = await app.inject({
      method: 'POST',
      payload: { email: 'operator@example.local', password },
      url: '/auth/login',
    });
    const auditResponse = await app.inject({
      headers: {
        cookie: sessionCookieFrom(loginResponse.headers),
      },
      method: 'GET',
      url: '/audit-events',
    });

    await app.close();

    expect(auditResponse.statusCode).toBe(403);
    expect(auditResponse.json()).toEqual({ error: 'insufficient_role' });
  });
});

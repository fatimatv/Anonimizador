import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { firstHeaderValue } from '../../common/utils/headers.js';
import type { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../../common/guards/roles.js';
import type { UserRepository } from '../users/user.repository.js';
import { PUBLIC_ACCESS_USER_ID } from '../users/user.repository.js';
import { AuthService } from './auth.service.js';
import {
  clearSessionCookie,
  readSessionCookie,
  serializeSessionCookie,
  type SessionService,
} from '../../security/session.js';

const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(256),
});

export interface AuthRoutesOptions {
  auditService: AuditService;
  sessionService: SessionService;
  userRepository: UserRepository;
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  options: AuthRoutesOptions,
): Promise<void> {
  const authService = new AuthService(options);

  app.post('/auth/login', async (request, reply) => {
    const parsedBody = loginSchema.safeParse(request.body);

    if (!parsedBody.success) {
      options.auditService.record({
        actorUserId: null,
        action: 'login',
        resourceType: 'session',
        result: 'blocked',
        metadata: { reason: 'invalid_login_payload' },
        ipHash: options.auditService.hashValue(request.ip),
        userAgentHash: options.auditService.hashValue(
          firstHeaderValue(request.headers['user-agent']),
        ),
      });

      return reply.code(400).send({ error: 'invalid_payload' });
    }

    const result = await authService.login({
      email: parsedBody.data.email,
      password: parsedBody.data.password,
      ip: request.ip,
      userAgent: firstHeaderValue(request.headers['user-agent']),
    });

    if (result.ok === false) {
      const statusCode = result.reason === 'locked' ? 423 : 401;

      return reply.code(statusCode).send({ error: result.publicError });
    }

    const session = options.sessionService.create(result.user);
    reply.header('set-cookie', serializeSessionCookie(session));

    return {
      expiresAt: session.expiresAt.toISOString(),
      user: result.user,
    };
  });

  app.post('/auth/public', async (request, reply) => {
    const user = await options.userRepository.findById(PUBLIC_ACCESS_USER_ID);

    if (!user?.isActive) {
      return reply.code(503).send({ error: 'public_access_unavailable' });
    }

    const authenticatedUser: AuthenticatedUser = {
      email: user.email,
      id: user.id,
      isActive: user.isActive,
      role: user.role,
    };
    const session = options.sessionService.create(authenticatedUser);

    options.auditService.record({
      actorUserId: user.id,
      action: 'login',
      resourceType: 'session',
      result: 'success',
      metadata: { publicAccess: true, role: user.role },
      ipHash: options.auditService.hashValue(request.ip),
      userAgentHash: options.auditService.hashValue(
        firstHeaderValue(request.headers['user-agent']),
      ),
    });
    reply.header('set-cookie', serializeSessionCookie(session));

    return {
      expiresAt: session.expiresAt.toISOString(),
      user: authenticatedUser,
    };
  });

  app.post('/auth/logout', async (request, reply) => {
    const currentUser = await getCurrentUserFromRequest(request, options);

    options.auditService.record({
      actorUserId: currentUser?.id ?? null,
      action: 'logout',
      resourceType: 'session',
      result: 'success',
      ipHash: options.auditService.hashValue(request.ip),
      userAgentHash: options.auditService.hashValue(
        firstHeaderValue(request.headers['user-agent']),
      ),
    });

    reply.header('set-cookie', clearSessionCookie(options.sessionService.cookieName));

    return { ok: true };
  });

  app.get('/auth/me', async (request, reply) => {
    const currentUser = await getCurrentUserFromRequest(request, options);

    if (!currentUser) {
      return reply.code(401).send({ error: 'authentication_required' });
    }

    return { user: currentUser };
  });
}

export async function getCurrentUserFromRequest(
  request: FastifyRequest,
  options: AuthRoutesOptions,
): Promise<AuthenticatedUser | null> {
  const token = readSessionCookie(request.headers.cookie, options.sessionService.cookieName);

  if (!token) {
    return null;
  }

  const payload = options.sessionService.verify(token);

  if (!payload) {
    return null;
  }

  const user = await options.userRepository.findById(payload.sub);

  if (!user?.isActive) {
    return null;
  }

  return {
    email: user.email,
    id: user.id,
    isActive: user.isActive,
    role: user.role,
  };
}

export function attachSessionCookie(reply: FastifyReply, cookie: string): void {
  reply.header('set-cookie', cookie);
}

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { canAccessRole, type AuthenticatedUser } from '../../common/guards/roles.js';
import { firstHeaderValue } from '../../common/utils/headers.js';
import type { AuditService } from './audit.service.js';

interface AuditRoutesOptions {
  auditService: AuditService;
  getCurrentUser: (request: FastifyRequest) => Promise<AuthenticatedUser | null>;
}

export async function registerAuditRoutes(
  app: FastifyInstance,
  options: AuditRoutesOptions,
): Promise<void> {
  app.get('/audit-events', async (request, reply) => {
    const currentUser = await options.getCurrentUser(request);

    if (!currentUser) {
      return reply.code(401).send({ error: 'authentication_required' });
    }

    if (!canAccessRole(currentUser, ['admin'])) {
      options.auditService.record({
        actorUserId: currentUser.id,
        action: 'security_event',
        resourceType: 'audit_event',
        result: 'blocked',
        metadata: {
          reason: 'insufficient_role',
          requiredRole: 'admin',
          actorRole: currentUser.role,
        },
        ipHash: options.auditService.hashValue(request.ip),
        userAgentHash: options.auditService.hashValue(
          firstHeaderValue(request.headers['user-agent']),
        ),
      });

      return reply.code(403).send({ error: 'insufficient_role' });
    }

    return {
      events: options.auditService.list(),
    };
  });
}

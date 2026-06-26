import * as argon2 from 'argon2';
import type { AuditService } from '../audit/audit.service.js';
import type { UserRepository } from '../users/user.repository.js';
import type { AuthenticatedUser } from '../../common/guards/roles.js';

interface AuthServiceOptions {
  auditService: AuditService;
  userRepository: UserRepository;
}

interface LoginInput {
  email: string;
  password: string;
  ip: string;
  userAgent: string | undefined;
}

type LoginResult =
  | {
      ok: true;
      user: AuthenticatedUser;
    }
  | {
      ok: false;
      publicError: 'invalid_credentials' | 'login_temporarily_blocked';
      reason: 'invalid' | 'locked';
    };

export class AuthService {
  constructor(private readonly options: AuthServiceOptions) {}

  async login(input: LoginInput): Promise<LoginResult> {
    const normalizedEmail = input.email.trim().toLowerCase();
    const user = await this.options.userRepository.findByEmail(normalizedEmail);
    const emailHash = this.options.auditService.hashValue(normalizedEmail);

    if (!user?.isActive) {
      this.options.auditService.record({
        actorUserId: null,
        action: 'login',
        resourceType: 'session',
        result: 'failure',
        metadata: { emailHash, reason: 'invalid_credentials' },
        ipHash: this.options.auditService.hashValue(input.ip),
        userAgentHash: this.options.auditService.hashValue(input.userAgent),
      });

      return { ok: false, publicError: 'invalid_credentials', reason: 'invalid' };
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      this.options.auditService.record({
        actorUserId: user.id,
        action: 'login',
        resourceType: 'session',
        result: 'blocked',
        metadata: { reason: 'account_temporarily_locked' },
        ipHash: this.options.auditService.hashValue(input.ip),
        userAgentHash: this.options.auditService.hashValue(input.userAgent),
      });

      return { ok: false, publicError: 'login_temporarily_blocked', reason: 'locked' };
    }

    const passwordMatches = await argon2.verify(user.passwordHash, input.password);

    if (!passwordMatches) {
      await this.options.userRepository.recordFailedLogin(user.id);

      this.options.auditService.record({
        actorUserId: user.id,
        action: 'login',
        resourceType: 'session',
        result: 'failure',
        metadata: { reason: 'invalid_credentials' },
        ipHash: this.options.auditService.hashValue(input.ip),
        userAgentHash: this.options.auditService.hashValue(input.userAgent),
      });

      return { ok: false, publicError: 'invalid_credentials', reason: 'invalid' };
    }

    await this.options.userRepository.recordSuccessfulLogin(user.id);

    const authenticatedUser: AuthenticatedUser = {
      email: user.email,
      id: user.id,
      isActive: user.isActive,
      role: user.role,
    };

    this.options.auditService.record({
      actorUserId: user.id,
      action: 'login',
      resourceType: 'session',
      result: 'success',
      metadata: { role: user.role },
      ipHash: this.options.auditService.hashValue(input.ip),
      userAgentHash: this.options.auditService.hashValue(input.userAgent),
    });

    return { ok: true, user: authenticatedUser };
  }
}

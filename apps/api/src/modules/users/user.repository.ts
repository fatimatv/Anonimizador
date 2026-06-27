import type { UserRole } from '../../common/types/privacy.js';

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  isActive: boolean;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserRepository {
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  recordFailedLogin(id: string): Promise<void>;
  recordSuccessfulLogin(id: string): Promise<void>;
}

interface InMemoryUserRepositoryOptions {
  lockAfterAttempts?: number;
  lockMinutes?: number;
  users?: UserRecord[];
}

export const PUBLIC_ACCESS_USER_ID = 'public-access-operator';
export const PUBLIC_ACCESS_USER_EMAIL = 'uso-publico@anonimizador.local';

const PUBLIC_ACCESS_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$ZjYJHLpFskwDZ+qlDiG5EQ$VqaCDi8Cc4s/iNqkJqrC5AEF/DZQVW0knU2hEwyq6Zg';

export class InMemoryUserRepository implements UserRepository {
  private readonly lockAfterAttempts: number;

  private readonly lockMinutes: number;

  private readonly usersById = new Map<string, UserRecord>();

  private readonly usersByEmail = new Map<string, UserRecord>();

  constructor(options: InMemoryUserRepositoryOptions = {}) {
    this.lockAfterAttempts = options.lockAfterAttempts ?? 5;
    this.lockMinutes = options.lockMinutes ?? 15;

    this.upsert(createPublicAccessUser());

    for (const user of options.users ?? []) {
      this.upsert(user);
    }
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    return this.usersByEmail.get(email.trim().toLowerCase()) ?? null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    return this.usersById.get(id) ?? null;
  }

  async recordFailedLogin(id: string): Promise<void> {
    const user = this.usersById.get(id);

    if (!user) {
      return;
    }

    user.failedLoginAttempts += 1;
    user.updatedAt = new Date();

    if (user.failedLoginAttempts >= this.lockAfterAttempts) {
      user.lockedUntil = new Date(Date.now() + this.lockMinutes * 60 * 1000);
    }
  }

  async recordSuccessfulLogin(id: string): Promise<void> {
    const user = this.usersById.get(id);

    if (!user) {
      return;
    }

    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    user.updatedAt = new Date();
  }

  private upsert(user: UserRecord): void {
    const normalizedUser: UserRecord = {
      ...user,
      email: user.email.trim().toLowerCase(),
    };

    this.usersById.set(normalizedUser.id, normalizedUser);
    this.usersByEmail.set(normalizedUser.email, normalizedUser);
  }
}

function createPublicAccessUser(): UserRecord {
  const now = new Date();

  return {
    createdAt: now,
    email: PUBLIC_ACCESS_USER_EMAIL,
    failedLoginAttempts: 0,
    id: PUBLIC_ACCESS_USER_ID,
    isActive: true,
    lockedUntil: null,
    passwordHash: PUBLIC_ACCESS_PASSWORD_HASH,
    role: 'operator',
    updatedAt: now,
  };
}

export function createBootstrapUserRepository(): UserRepository {
  const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const adminPasswordHash = process.env.BOOTSTRAP_ADMIN_PASSWORD_HASH;

  if (!adminEmail || !adminPasswordHash || adminPasswordHash.startsWith('replace-with-')) {
    return new InMemoryUserRepository();
  }

  const now = new Date();

  return new InMemoryUserRepository({
    users: [
      {
        createdAt: now,
        email: adminEmail,
        failedLoginAttempts: 0,
        id: 'bootstrap-admin',
        isActive: true,
        lockedUntil: null,
        passwordHash: adminPasswordHash,
        role: 'admin',
        updatedAt: now,
      },
    ],
  });
}

import type { UserRole } from '../types/privacy.js';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
  isActive: boolean;
}

export function canAccessRole(user: AuthenticatedUser, allowedRoles: readonly UserRole[]): boolean {
  return user.isActive && allowedRoles.includes(user.role);
}

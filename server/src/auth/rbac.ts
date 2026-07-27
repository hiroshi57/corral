// ⑤ RBAC: ロール別の権限マトリクス
import type { Permission, Role } from '../types.js';

const MATRIX: Record<Role, Permission[]> = {
  owner: [
    'workspace:manage',
    'member:manage',
    'session:create',
    'session:instruct',
    'session:approve',
    'session:view',
  ],
  admin: [
    'workspace:manage',
    'member:manage',
    'session:create',
    'session:instruct',
    'session:approve',
    'session:view',
  ],
  member: ['session:create', 'session:instruct', 'session:approve', 'session:view'],
  viewer: ['session:view'],
};

export function can(role: Role, perm: Permission): boolean {
  return MATRIX[role]?.includes(perm) ?? false;
}

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'オーナー',
  admin: '管理者',
  member: 'メンバー',
  viewer: '閲覧者',
};

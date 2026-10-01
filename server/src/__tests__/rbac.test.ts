import { describe, expect, it } from 'vitest';
import { can } from '../auth/rbac.js';
import type { Permission, Role } from '../types.js';

// 権限マトリクスを表で固定する。ゲートの付け忘れ・付け替えを機械的に検出する。
const EXPECTED: Record<Role, Record<Permission, boolean>> = {
  owner: {
    'workspace:manage': true,
    'workspace:create': true,
    'member:manage': true,
    'session:create': true,
    'session:instruct': true,
    'session:approve': true,
    'session:view': true,
    'session:delete': true,
    'audit:view': true,
  },
  admin: {
    'workspace:manage': true,
    'workspace:create': true,
    'member:manage': true,
    'session:create': true,
    'session:instruct': true,
    'session:approve': true,
    'session:view': true,
    'session:delete': true,
    'audit:view': true,
  },
  member: {
    'workspace:manage': false,
    'workspace:create': false,
    'member:manage': false,
    'session:create': true,
    'session:instruct': true,
    'session:approve': true,
    'session:view': true,
    'session:delete': false,
    'audit:view': false,
  },
  viewer: {
    'workspace:manage': false,
    'workspace:create': false,
    'member:manage': false,
    'session:create': false,
    'session:instruct': false,
    'session:approve': false,
    'session:view': true,
    'session:delete': false,
    'audit:view': false,
  },
};

describe('RBAC 権限マトリクス', () => {
  for (const [role, perms] of Object.entries(EXPECTED) as Array<
    [Role, Record<Permission, boolean>]
  >) {
    for (const [perm, allowed] of Object.entries(perms) as Array<[Permission, boolean]>) {
      it(`${role} は ${perm} を ${allowed ? '持つ' : '持たない'}`, () => {
        expect(can(role, perm)).toBe(allowed);
      });
    }
  }

  it('member は案件を新規作成できない（自己 owner 昇格の防止）', () => {
    expect(can('member', 'workspace:create')).toBe(false);
  });

  it('viewer は閲覧以外のいかなる権限も持たない', () => {
    const all = Object.keys(EXPECTED.owner) as Permission[];
    const granted = all.filter((p) => can('viewer', p));
    expect(granted).toEqual(['session:view']);
  });
});

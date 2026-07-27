// ④ テナンシー: ユーザー / ワークスペース（案件） / メンバーシップ（インメモリ）
import { nanoid } from 'nanoid';
import type { Membership, Role, User, Workspace } from '../types.js';

/** マシントークン(x-corral-token)由来のオーナー擬似ユーザー */
export const MACHINE_USER: User = {
  id: 'machine',
  email: 'local@corral',
  name: 'ローカル(オーナー)',
  provider: 'token',
};

class TenancyStore {
  private users = new Map<string, User>();
  private workspaces = new Map<string, Workspace>();
  private memberships: Membership[] = [];

  constructor() {
    this.users.set(MACHINE_USER.id, MACHINE_USER);
    // 既定の案件（ワークスペース）を1つ用意
    const ws: Workspace = {
      id: 'default',
      name: 'サンプル案件',
      createdAt: Date.now(),
      ownerId: MACHINE_USER.id,
    };
    this.workspaces.set(ws.id, ws);
    this.memberships.push({ workspaceId: ws.id, userId: MACHINE_USER.id, role: 'owner' });
  }

  // --- users ---
  upsertUser(u: Omit<User, 'id'> & { id?: string }): User {
    const existing = [...this.users.values()].find((x) => x.email === u.email);
    if (existing) return existing;
    const user: User = { id: u.id ?? nanoid(8), email: u.email, name: u.name, provider: u.provider };
    this.users.set(user.id, user);
    // 新規ユーザーは既定案件へ member として参加（体験用）。オーナーが後で昇格可能
    this.memberships.push({ workspaceId: 'default', userId: user.id, role: 'member' });
    return user;
  }

  getUser(id: string): User | undefined {
    return this.users.get(id);
  }

  // --- workspaces ---
  listWorkspacesForUser(userId: string): Array<Workspace & { role: Role }> {
    return this.memberships
      .filter((m) => m.userId === userId)
      .map((m) => {
        const ws = this.workspaces.get(m.workspaceId)!;
        return ws ? { ...ws, role: m.role } : null;
      })
      .filter((x): x is Workspace & { role: Role } => !!x);
  }

  getWorkspace(id: string): Workspace | undefined {
    return this.workspaces.get(id);
  }

  createWorkspace(name: string, ownerId: string): Workspace {
    const ws: Workspace = { id: nanoid(8), name, createdAt: Date.now(), ownerId };
    this.workspaces.set(ws.id, ws);
    this.memberships.push({ workspaceId: ws.id, userId: ownerId, role: 'owner' });
    return ws;
  }

  // --- membership / roles ---
  roleOf(userId: string, workspaceId: string): Role | null {
    // マシンユーザーは常にオーナー
    if (userId === MACHINE_USER.id) return 'owner';
    const m = this.memberships.find((x) => x.userId === userId && x.workspaceId === workspaceId);
    return m?.role ?? null;
  }

  addMember(workspaceId: string, userId: string, role: Role): void {
    const m = this.memberships.find((x) => x.userId === userId && x.workspaceId === workspaceId);
    if (m) m.role = role;
    else this.memberships.push({ workspaceId, userId, role });
  }

  membersOf(workspaceId: string): Array<{ user: User; role: Role }> {
    return this.memberships
      .filter((m) => m.workspaceId === workspaceId)
      .map((m) => ({ user: this.users.get(m.userId)!, role: m.role }))
      .filter((x) => !!x.user);
  }
}

export const tenancy = new TenancyStore();

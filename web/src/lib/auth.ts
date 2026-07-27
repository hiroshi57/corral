// ⑤ クライアント側のロール権限＋⑤/④ の保存（セッション/現在の案件）
export type Role = 'owner' | 'admin' | 'member' | 'viewer';
export type Permission =
  | 'workspace:manage'
  | 'member:manage'
  | 'session:create'
  | 'session:instruct'
  | 'session:approve'
  | 'session:view';

const MATRIX: Record<Role, Permission[]> = {
  owner: ['workspace:manage', 'member:manage', 'session:create', 'session:instruct', 'session:approve', 'session:view'],
  admin: ['workspace:manage', 'member:manage', 'session:create', 'session:instruct', 'session:approve', 'session:view'],
  member: ['session:create', 'session:instruct', 'session:approve', 'session:view'],
  viewer: ['session:view'],
};

export function can(role: Role | null, perm: Permission): boolean {
  return !!role && MATRIX[role].includes(perm);
}

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'オーナー',
  admin: '管理者',
  member: 'メンバー',
  viewer: '閲覧者',
};

// --- localStorage 保存 ---
const K_SESSION = 'corral_session';
const K_WS = 'corral_ws';

export const store = {
  getSession: () => localStorage.getItem(K_SESSION) ?? '',
  setSession: (t: string) => localStorage.setItem(K_SESSION, t),
  clearSession: () => localStorage.removeItem(K_SESSION),
  getWorkspace: () => localStorage.getItem(K_WS) ?? 'default',
  setWorkspace: (id: string) => localStorage.setItem(K_WS, id),
};

export interface User {
  id: string;
  email: string;
  name: string;
  provider: string;
}
export interface WorkspaceInfo {
  id: string;
  name: string;
  createdAt: number;
  ownerId: string;
  role: Role;
}

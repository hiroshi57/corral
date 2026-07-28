// ⑤ 認証 & ④ ワークスペース解決 & RBAC のミドルウェア
import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';
import { verifySession } from './tokens.js';
import { can } from './rbac.js';
import { tenancy, MACHINE_USER } from '../tenancy/store.js';
import { audit } from '../audit/log.js';
import type { Identity, Permission, Role } from '../types.js';

// Express の Request に識別情報を付与
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      identity?: Identity;
      workspaceId?: string;
      role?: Role;
    }
  }
}

/**
 * 認証: x-corral-token（マシン=オーナー） or x-corral-session（ユーザー）を解決。
 * health / auth 系はスキップ。未認証は 401。
 */
export function resolveIdentity(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'OPTIONS') return next();
  if (req.path === '/health' || req.path.startsWith('/auth/')) return next();

  // マシントークン（ローカル/プロキシ）→ オーナー
  if (req.header('x-corral-token') === config.token) {
    req.identity = { user: MACHINE_USER, machine: true };
    return next();
  }
  // ユーザーセッション
  const sess = req.header('x-corral-session');
  if (sess) {
    const claims = verifySession(sess);
    if (claims) {
      const user = tenancy.getUser(claims.sub) ?? {
        id: claims.sub,
        email: claims.email,
        name: claims.name,
        provider: claims.provider,
      };
      req.identity = { user, machine: false };
      return next();
    }
  }
  res.status(401).json({ error: '認証が必要です' });
}

/** ④ ワークスペース（案件）を解決し、メンバーシップ(ロール)を確定 */
export function resolveWorkspace(req: Request, res: Response, next: NextFunction): void {
  if (!req.identity) return next();
  const wsId = req.header('x-corral-workspace') || req.query.workspace?.toString() || 'default';
  const ws = tenancy.getWorkspace(wsId);
  if (!ws) return void res.status(404).json({ error: `ワークスペースが見つかりません: ${wsId}` });
  const role = tenancy.roleOf(req.identity.user.id, wsId);
  if (!role) return void res.status(403).json({ error: 'このワークスペースへのアクセス権がありません' });
  req.workspaceId = wsId;
  req.role = role;
  next();
}

/** ⑤ 権限ゲート */
export function requirePerm(perm: Permission) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.role || !can(req.role, perm)) {
      // 監査: 権限拒否を記録
      audit.record({
        actorId: req.identity?.user.id ?? 'anon',
        actorEmail: req.identity?.user.email ?? 'anon',
        action: `perm.denied:${perm}`,
        workspaceId: req.workspaceId ?? null,
        target: `${req.method} ${req.path}`,
        outcome: 'denied',
        ip: req.ip,
      });
      return void res.status(403).json({ error: `権限がありません（${perm}）` });
    }
    next();
  };
}

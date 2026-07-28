// REST API ルート
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { SessionManager } from '../session/manager.js';
import { config } from '../config.js';
import { configuredChannels, notify } from '../notify/notifier.js';
import { resolveWorkspace, requirePerm } from '../auth/middleware.js';
import { tenancy } from '../tenancy/store.js';
import { repoStore } from '../tenancy/repos.js';
import { ROLE_LABEL } from '../auth/rbac.js';
import type { CreateSessionInput, Role } from '../types.js';

export function createRouter(sessions: SessionManager): Router {
  const router = Router();

  // ヘルスチェック / 設定
  router.get('/health', (_req, res) => {
    res.json({
      ok: true,
      demo: config.demo,
      repoRoot: config.repoRoot,
      notifyChannels: configuredChannels(),
      budgetUsd: config.finops.budgetUsd,
      execMode: config.exec.mode,
      guardrails: config.guardrails.enabled,
    });
  });

  // 対象セッションが現在のワークスペース(案件)に属するか検証
  const inWorkspace = (req: Request, res: Response, next: NextFunction) => {
    if (!sessions.belongsTo(req.params.id, req.workspaceId!)) {
      return void res.status(404).json({ error: 'この案件に該当するワーカーがありません' });
    }
    next();
  };

  // ---- ④ ワークスペース（案件） ----
  router.get('/workspaces', resolveWorkspace, (req, res) => {
    res.json(tenancy.listWorkspacesForUser(req.identity!.user.id));
  });

  router.post('/workspaces', resolveWorkspace, (req, res) => {
    const { name } = req.body as { name?: string };
    if (!name?.trim()) return res.status(400).json({ error: '案件名は必須です' });
    const ws = tenancy.createWorkspace(name.trim(), req.identity!.user.id);
    res.status(201).json(ws);
  });

  // #4 マルチリポ: 案件のリポジトリ一覧 / 追加
  router.get('/repos', resolveWorkspace, requirePerm('session:view'), (req, res) => {
    res.json(repoStore.listForWorkspace(req.workspaceId!));
  });
  router.post('/repos', resolveWorkspace, requirePerm('workspace:manage'), (req, res) => {
    const { name, path } = req.body as { name?: string; path?: string };
    if (!name?.trim() || !path?.trim()) return res.status(400).json({ error: 'name と path は必須です' });
    res.status(201).json(repoStore.create(req.workspaceId!, name.trim(), path.trim()));
  });

  // メンバー一覧 / 追加（⑤ member:manage 権限）
  router.get('/workspaces/members', resolveWorkspace, requirePerm('member:manage'), (req, res) => {
    res.json(tenancy.membersOf(req.workspaceId!).map((m) => ({ ...m.user, role: m.role })));
  });
  router.post('/workspaces/members', resolveWorkspace, requirePerm('member:manage'), (req, res) => {
    const { email, name, role } = req.body as { email?: string; name?: string; role?: Role };
    if (!email) return res.status(400).json({ error: 'email は必須です' });
    const user = tenancy.upsertUser({ email, name: name || email, provider: 'invited' });
    tenancy.addMember(req.workspaceId!, user.id, role ?? 'member');
    res.status(201).json({ ...user, role: role ?? 'member' });
  });

  // ---- セッション（案件スコープ＋RBAC） ----
  router.get('/sessions', resolveWorkspace, requirePerm('session:view'), (req, res) => {
    res.json(sessions.list(req.workspaceId));
  });

  router.get('/sessions/:id', resolveWorkspace, requirePerm('session:view'), inWorkspace, (req, res) => {
    const s = sessions.get(req.params.id);
    if (!s) return res.status(404).json({ error: 'not found' });
    res.json(s);
  });

  // 作成（台数指定で一括）
  router.post('/sessions', resolveWorkspace, requirePerm('session:create'), async (req, res) => {
    const body = req.body as CreateSessionInput;
    if (!body?.prompt || !body?.agent) {
      return res.status(400).json({ error: 'agent と prompt は必須です' });
    }
    try {
      const created = await sessions.createBatch(body, req.workspaceId!);
      res.status(201).json(created);
    } catch (e) {
      res.status(402).json({ error: (e as Error).message }); // ② 予算ハードキャップ等
    }
  });

  router.post('/sessions/:id/instruct', resolveWorkspace, requirePerm('session:instruct'), inWorkspace, (req, res) => {
    const { text } = req.body as { text: string };
    if (!text) return res.status(400).json({ error: 'text は必須です' });
    res.json({ ok: sessions.instruct(req.params.id, text) });
  });

  // broadcast（現在の案件のワーカーのみ）
  router.post('/broadcast', resolveWorkspace, requirePerm('session:instruct'), (req, res) => {
    const { text, targetIds } = req.body as { text: string; targetIds?: string[] };
    if (!text) return res.status(400).json({ error: 'text は必須です' });
    const ids = (targetIds ?? sessions.list(req.workspaceId).map((s) => s.id)).filter((id) =>
      sessions.belongsTo(id, req.workspaceId!)
    );
    res.json({ delivered: sessions.broadcast(text, ids) });
  });

  router.get('/sessions/:id/diff', resolveWorkspace, requirePerm('session:view'), inWorkspace, async (req, res) => {
    res.json({ diff: await sessions.diff(req.params.id) });
  });

  router.post('/sessions/:id/approve', resolveWorkspace, requirePerm('session:approve'), inWorkspace, async (req, res) => {
    const { message } = req.body as { message?: string };
    res.json({ ok: await sessions.approve(req.params.id, message ?? 'corral: approved') });
  });

  router.post('/sessions/:id/stop', resolveWorkspace, requirePerm('session:instruct'), inWorkspace, (req, res) => {
    res.json({ ok: sessions.stop(req.params.id) });
  });

  router.delete('/sessions/:id', resolveWorkspace, requirePerm('session:create'), inWorkspace, async (req, res) => {
    res.json({ ok: await sessions.remove(req.params.id) });
  });

  // ② FinOps サマリ（案件スコープ）
  router.get('/finops', resolveWorkspace, requirePerm('session:view'), (req, res) => {
    res.json(sessions.finopsSummary(req.workspaceId));
  });

  // ① 通知テスト送信
  router.post('/notify/test', resolveWorkspace, requirePerm('session:view'), async (_req, res) => {
    res.json(
      await notify({ sessionId: 'test', title: '通知テスト', status: 'done', branch: null, demo: config.demo })
    );
  });

  // ロール表示ラベル（UI 補助）
  router.get('/roles', (_req, res) => res.json(ROLE_LABEL));

  return router;
}

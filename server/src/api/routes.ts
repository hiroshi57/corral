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
import { audit } from '../audit/log.js';
import { planDocument, planGraph } from '../intake/planner.js';
import { detectAgents } from '../agents/detect.js';
import type { AgentKind, AuditEvent, CreateSessionInput, Role } from '../types.js';

export function createRouter(sessions: SessionManager): Router {
  const router = Router();

  // 監査記録ヘルパ（リクエスト文脈で誰が/どこで を補完）
  const rec = (
    req: Request,
    action: string,
    outcome: AuditEvent['outcome'],
    target: string | null,
    detail?: string
  ) =>
    audit.record({
      actorId: req.identity?.user.id ?? 'anon',
      actorEmail: req.identity?.user.email ?? 'anon',
      action,
      workspaceId: req.workspaceId ?? null,
      target,
      outcome,
      detail,
      ip: req.ip,
    });

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
    rec(req, 'workspace.create', 'success', ws.id, ws.name);
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
    rec(req, 'member.add', 'success', user.id, `${email} as ${role ?? 'member'}`);
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
      rec(req, 'session.create', 'success', created.map((s) => s.id).join(','), body.prompt.slice(0, 80));
      res.status(201).json(created);
    } catch (e) {
      rec(req, 'session.create', 'error', null, (e as Error).message);
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
    const ok = await sessions.approve(req.params.id, message ?? 'corral: approved');
    rec(req, 'session.approve', ok ? 'success' : 'denied', req.params.id);
    res.json({ ok });
  });

  router.post('/sessions/:id/stop', resolveWorkspace, requirePerm('session:instruct'), inWorkspace, (req, res) => {
    rec(req, 'session.stop', 'success', req.params.id);
    res.json({ ok: sessions.stop(req.params.id) });
  });

  router.delete('/sessions/:id', resolveWorkspace, requirePerm('session:create'), inWorkspace, async (req, res) => {
    rec(req, 'session.remove', 'success', req.params.id);
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

  // ドキュメント → LLM プランナーでタスク分解（実エージェント。空なら client がフォールバック）
  router.post('/intake/plan', resolveWorkspace, requirePerm('session:create'), async (req, res) => {
    const { text, agent } = req.body as { text?: string; agent?: AgentKind };
    if (!text?.trim()) return res.status(400).json({ error: 'text は必須です' });
    const tasks = await planDocument(text, agent ?? 'claude');
    rec(req, 'intake.plan', 'success', null, `${tasks.length} tasks`);
    res.json({ tasks });
  });

  // ドキュメント → グラフ(DAG)としてタスク分解（グラフ・エンジニアリング）
  router.post('/intake/graph', resolveWorkspace, requirePerm('session:create'), async (req, res) => {
    const { text, agent } = req.body as { text?: string; agent?: AgentKind };
    if (!text?.trim()) return res.status(400).json({ error: 'text は必須です' });
    const nodes = await planGraph(text, agent ?? 'claude');
    rec(req, 'intake.graph', 'success', null, `${nodes.length} nodes`);
    res.json({ nodes });
  });

  // グラフGUIエディタ: 依存/条件/座標の更新
  router.patch('/sessions/:id/graph', resolveWorkspace, requirePerm('session:create'), inWorkspace, (req, res) => {
    const { dependsOn, dependsCondition, graphPos } = req.body as {
      dependsOn?: string[];
      dependsCondition?: 'success' | 'failure' | 'any';
      graphPos?: { x: number; y: number };
    };
    const ok = sessions.updateGraph(req.params.id, { dependsOn, dependsCondition, graphPos });
    if (dependsOn || dependsCondition) rec(req, 'graph.update', ok ? 'success' : 'error', req.params.id);
    res.json({ ok });
  });

  // セッション横断検索
  router.get('/search', resolveWorkspace, requirePerm('session:view'), (req, res) => {
    const q = req.query.q?.toString() ?? '';
    res.json({ results: sessions.search(q, req.workspaceId) });
  });

  // エージェント自動検出
  router.get('/agents', resolveWorkspace, requirePerm('session:view'), async (_req, res) => {
    res.json(await detectAgents());
  });

  // 監査ログ（owner/admin のみ）+ SIEM 状態
  router.get('/audit', resolveWorkspace, requirePerm('audit:view'), (req, res) => {
    res.json({
      siemConnected: audit.siemConnected(),
      events: audit.list({
        workspaceId: req.identity!.machine ? undefined : req.workspaceId,
        action: req.query.action?.toString(),
        limit: Number(req.query.limit ?? 500),
      }),
    });
  });

  // 監査ログのエクスポート（NDJSON）
  router.get('/audit/export', resolveWorkspace, requirePerm('audit:view'), (req, res) => {
    const nd = audit.exportNdjson(req.identity!.machine ? undefined : req.workspaceId);
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Content-Disposition', 'attachment; filename="corral-audit.ndjson"');
    res.send(nd);
  });

  // ロール表示ラベル（UI 補助）
  router.get('/roles', (_req, res) => res.json(ROLE_LABEL));

  return router;
}

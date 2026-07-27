// REST API ルート
import { Router } from 'express';
import type { SessionManager } from '../session/manager.js';
import { config } from '../config.js';
import { configuredChannels, notify } from '../notify/notifier.js';
import type { CreateSessionInput } from '../types.js';

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
    });
  });

  // セッション一覧
  router.get('/sessions', (_req, res) => {
    res.json(sessions.list());
  });

  // セッション詳細（ログ込み）
  router.get('/sessions/:id', (req, res) => {
    const s = sessions.get(req.params.id);
    if (!s) return res.status(404).json({ error: 'not found' });
    res.json(s);
  });

  // 作成（台数指定で一括）
  router.post('/sessions', async (req, res) => {
    const body = req.body as CreateSessionInput;
    if (!body?.prompt || !body?.agent) {
      return res.status(400).json({ error: 'agent と prompt は必須です' });
    }
    try {
      const created = await sessions.createBatch(body);
      res.status(201).json(created);
    } catch (e) {
      // ② 予算ハードキャップ等
      res.status(402).json({ error: (e as Error).message });
    }
  });

  // 追加指示（個別）
  router.post('/sessions/:id/instruct', (req, res) => {
    const { text } = req.body as { text: string };
    if (!text) return res.status(400).json({ error: 'text は必須です' });
    const ok = sessions.instruct(req.params.id, text);
    res.json({ ok });
  });

  // broadcast（全員 or 対象）
  router.post('/broadcast', (req, res) => {
    const { text, targetIds } = req.body as { text: string; targetIds?: string[] };
    if (!text) return res.status(400).json({ error: 'text は必須です' });
    const count = sessions.broadcast(text, targetIds);
    res.json({ delivered: count });
  });

  // diff 取得
  router.get('/sessions/:id/diff', async (req, res) => {
    res.json({ diff: await sessions.diff(req.params.id) });
  });

  // 承認（checkpoint）
  router.post('/sessions/:id/approve', async (req, res) => {
    const { message } = req.body as { message?: string };
    const ok = await sessions.approve(req.params.id, message ?? 'corral: approved');
    res.json({ ok });
  });

  // 停止
  router.post('/sessions/:id/stop', (req, res) => {
    res.json({ ok: sessions.stop(req.params.id) });
  });

  // 破棄
  router.delete('/sessions/:id', async (req, res) => {
    res.json({ ok: await sessions.remove(req.params.id) });
  });

  // ② FinOps サマリ
  router.get('/finops', (_req, res) => {
    res.json(sessions.finopsSummary());
  });

  // ① 通知テスト送信
  router.post('/notify/test', async (_req, res) => {
    const event = await notify({
      sessionId: 'test',
      title: '通知テスト',
      status: 'done',
      branch: null,
      demo: config.demo,
    });
    res.json(event);
  });

  return router;
}

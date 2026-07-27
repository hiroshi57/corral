// 環境変数ベースの設定
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

// このファイルは server/(src|dist)/config.* にあるため、2つ上が corral ルート
const here = path.dirname(fileURLToPath(import.meta.url));
const corralRoot = path.resolve(here, '..', '..');

const port = Number(process.env.CORRAL_PORT ?? 4319);
const host = process.env.CORRAL_HOST ?? '127.0.0.1';

export const config = {
  port,
  host,
  /** デモモード（既定 ON）。実運用は CORRAL_DEMO=0 */
  demo: process.env.CORRAL_DEMO !== '0',
  /** 対象リポジトリのルート（worktree の親） */
  repoRoot: path.resolve(process.env.CORRAL_REPO ?? process.cwd()),
  /** worktree を作るベースディレクトリ */
  worktreeBase: path.resolve(
    process.env.CORRAL_WORKTREE_BASE ?? path.join(process.cwd(), '.corral', 'worktrees')
  ),
  /** 1セッションが保持する最大ログ行数 */
  maxLogLines: Number(process.env.CORRAL_MAX_LOG ?? 2000),
  /** corral モノレポのルート（トークン共有ファイルの置き場） */
  corralRoot,
  /** APIアクセストークン（未指定ならランダム生成し token ファイルへ書き出す） */
  token: process.env.CORRAL_TOKEN ?? randomUUID(),
  /** トークン共有ファイル（Vite プロキシが読んでヘッダに付与する） */
  tokenFile: path.join(corralRoot, '.corral', 'token'),
  /** CORS で許可するオリジン（ローカルのダッシュボードのみ） */
  allowedOrigins: [
    `http://127.0.0.1:5319`,
    `http://localhost:5319`,
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
  ],
  /** Host ヘッダとして許可するホスト名（DNSリバインディング対策） */
  allowedHosts: new Set(['127.0.0.1', 'localhost', '[::1]', '::1', host]),

  // --- ① 通知 ---
  notify: {
    /** Chatwork API トークン（国内向け通知） */
    chatworkToken: process.env.CORRAL_CHATWORK_TOKEN ?? '',
    /** Chatwork ルームID */
    chatworkRoom: process.env.CORRAL_CHATWORK_ROOM ?? '',
    /** Slack Incoming Webhook URL */
    slackWebhook: process.env.CORRAL_SLACK_WEBHOOK ?? '',
    /** 通知するステータス（既定: 要確認/完了/エラー） */
    events: (process.env.CORRAL_NOTIFY_EVENTS ?? 'needs_review,done,error').split(','),
  },

  // --- ② FinOps（コスト計測） ---
  finops: {
    /** 予算（USD, 累計）。0 = 無制限 */
    budgetUsd: Number(process.env.CORRAL_BUDGET_USD ?? 0),
    /** 予算到達で新規セッションを止めるか */
    hardCap: process.env.CORRAL_BUDGET_HARDCAP === '1',
    /** アラート閾値（予算に対する割合 0-1） */
    alertRatio: Number(process.env.CORRAL_BUDGET_ALERT ?? 0.8),
  },
};

export type Config = typeof config;

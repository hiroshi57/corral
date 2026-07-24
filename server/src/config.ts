// 環境変数ベースの設定
import path from 'node:path';

export const config = {
  /** デーモンのポート */
  port: Number(process.env.CORRAL_PORT ?? 4319),
  /** バインドホスト（既定はローカルのみ） */
  host: process.env.CORRAL_HOST ?? '127.0.0.1',
  /**
   * デモモード：エージェント CLI が無くても動く疑似実行。
   * 既定は ON（初回起動でそのまま動くように）。実運用は CORRAL_DEMO=0。
   */
  demo: process.env.CORRAL_DEMO !== '0',
  /** 対象リポジトリのルート（worktree の親） */
  repoRoot: path.resolve(process.env.CORRAL_REPO ?? process.cwd()),
  /** worktree を作るベースディレクトリ */
  worktreeBase: path.resolve(
    process.env.CORRAL_WORKTREE_BASE ?? path.join(process.cwd(), '.corral', 'worktrees')
  ),
  /** 1セッションが保持する最大ログ行数 */
  maxLogLines: Number(process.env.CORRAL_MAX_LOG ?? 2000),
};

export type Config = typeof config;

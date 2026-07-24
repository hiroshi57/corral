// Corral 共通型定義（サーバ側）

/** セッションの状態 */
export type SessionStatus =
  | 'queued' // 起動待ち
  | 'running' // 実行中
  | 'needs_review' // 変更あり・承認待ち
  | 'done' // 完了
  | 'error' // エラー
  | 'stopped'; // 手動停止

/** 対応エージェント種別 */
export type AgentKind = 'claude' | 'codex' | 'gemini' | 'aider' | 'custom';

/** 出力ログの1行 */
export interface LogLine {
  ts: number;
  stream: 'stdout' | 'stderr' | 'system';
  text: string;
}

/** ワーカー(=1エージェントセッション) */
export interface Session {
  id: string;
  title: string;
  agent: AgentKind;
  /** 実行するプロンプト/タスク */
  prompt: string;
  status: SessionStatus;
  /** git worktree のパス */
  worktreePath: string | null;
  /** 作業ブランチ名 */
  branch: string | null;
  /** auto-accept（確認を自動承認） */
  autoAccept: boolean;
  createdAt: number;
  updatedAt: number;
  exitCode: number | null;
  /** 変更ファイル数（diff の概要） */
  changedFiles: number;
  /**
   * 指示の履歴（1件目=初回タスク、以降=追加指示）。
   * 追加指示は stdin 注入ではなく「継続run」で反映するため、文脈保持に使う。
   */
  turns: string[];
  /** 実行中に届いた追加指示。現ランの終了後に継続runとして流す */
  pendingFollowups: string[];
  /** 直近ログ（リングバッファ） */
  logs: LogLine[];
}

/** クライアントへ返す軽量サマリ（logs を除く） */
export type SessionSummary = Omit<Session, 'logs'>;

/** WebSocket でブラウザへ送るイベント */
export type ServerEvent =
  | { type: 'snapshot'; sessions: SessionSummary[] }
  | { type: 'session:update'; session: SessionSummary }
  | { type: 'session:removed'; id: string }
  | { type: 'log'; id: string; line: LogLine };

/** セッション作成リクエスト */
export interface CreateSessionInput {
  title?: string;
  agent: AgentKind;
  prompt: string;
  /** 台数（uzi の claude:3 に相当） */
  count?: number;
  autoAccept?: boolean;
}

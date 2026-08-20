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

// --- ④ マルチテナント（ワークスペース＝案件） / ⑤ ユーザー・ロール ---

/** ロール（権限の役割） */
export type Role = 'owner' | 'admin' | 'member' | 'viewer';

/** 権限 */
export type Permission =
  | 'workspace:manage'
  | 'member:manage'
  | 'session:create'
  | 'session:instruct'
  | 'session:approve'
  | 'session:view'
  | 'audit:view';

/** 監査ログの1件（誰が・いつ・何を・結果） */
export interface AuditEvent {
  ts: number;
  actorId: string;
  actorEmail: string;
  action: string; // 例: session.create / session.approve / auth.login / guardrail.block
  workspaceId: string | null;
  target: string | null; // 対象ID等
  outcome: 'success' | 'denied' | 'error';
  detail?: string;
  ip?: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  /** 認証プロバイダ（dev / google / token） */
  provider: string;
}

/** ワークスペース＝案件（プロジェクト）の器 */
export interface Workspace {
  id: string;
  /** 案件名 */
  name: string;
  createdAt: number;
  ownerId: string;
}

export interface Membership {
  workspaceId: string;
  userId: string;
  role: Role;
}

/** 認証済みの実行主体 */
export interface Identity {
  user: User;
  /** マシントークン（x-corral-token）由来か */
  machine: boolean;
}

/** #2 プレイブック: グラフ(DAG)のテンプレート */
export interface PlaybookNode {
  /** テンプレ内の一時ID */
  ref: number;
  text: string;
  /** 依存する ref 群 */
  deps: number[];
  /** 指定があればこのエージェントで実行 */
  agent?: AgentKind;
  /** 条件付きエッジ */
  condition?: 'success' | 'failure' | 'any';
}

export interface Playbook {
  id: string;
  name: string;
  description?: string;
  /** 作成元の案件（null=全案件で共有のプリセット） */
  workspaceId: string | null;
  nodes: PlaybookNode[];
  createdAt: number;
  builtin?: boolean;
}

/** #4 マルチリポ: 案件が抱える対象リポジトリ */
export interface Repo {
  id: string;
  name: string;
  path: string;
  workspaceId: string;
}

/** #20 ガードレール違反 */
export interface GuardrailViolation {
  ts: number;
  kind: 'deny-command' | 'protected-path' | 'secret-leak' | 'too-many-changes';
  detail: string;
  /** 実行/承認をブロックしたか（警告のみなら false） */
  blocked: boolean;
}

/** ② FinOps: 1セッションのトークン/コスト消費 */
export interface Usage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** 継続runの回数（＝エージェント起動回数） */
  runs: number;
}

/** ① 通知イベント */
export interface NotifyEvent {
  ts: number;
  sessionId: string;
  title: string;
  status: SessionStatus;
  /** 送信チャネルの結果 */
  channels: string[];
  message: string;
}

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
  /** ④ 所属ワークスペース（案件）ID */
  workspaceId: string;
  /** #4 対象リポジトリID */
  repoId: string | null;
  /** #1 依存タスク（この session ID 群が done になるまで開始しない） */
  dependsOn: string[];
  /**
   * 条件付きエッジ: 依存元の結果で分岐する。
   * on='success'(既定)=依存が done で起動 / 'failure'=依存が error/stopped で起動 / 'any'=どちらでも
   */
  dependsCondition: 'success' | 'failure' | 'any';
  /** グラフGUIエディタ用の座標（任意） */
  graphPos?: { x: number; y: number };
  /** #20 ガードレール違反の履歴 */
  violations: GuardrailViolation[];
  /** 失敗理由の分類（利用上限・認証切れ等をUIで分かるようにする） */
  failureReason?: 'usage-limit' | 'auth' | 'not-found' | 'unknown';
  /** 試行済みエージェント（自動フォールバックの重複回避） */
  triedAgents?: AgentKind[];
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
  /** ② FinOps: 消費トークン/コスト */
  usage: Usage;
  /** ③ 生産性: 人手介入回数（追加指示/差し戻しの回数）。自動完了なら 0 */
  interventions: number;
  /** 実行に要した総ミリ秒（各runの合計） */
  durationMs: number;
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
  | { type: 'log'; id: string; line: LogLine }
  | { type: 'notify'; event: NotifyEvent }
  | { type: 'budget'; level: 'alert' | 'exceeded'; totalUsd: number; budgetUsd: number }
  | { type: 'guardrail'; sessionId: string; violation: GuardrailViolation };

/** セッション作成リクエスト */
export interface CreateSessionInput {
  title?: string;
  agent: AgentKind;
  prompt: string;
  /** 台数（uzi の claude:3 に相当） */
  count?: number;
  autoAccept?: boolean;
  /** #4 対象リポジトリID */
  repoId?: string;
  /** #1 依存タスク（これらが完了してから開始） */
  dependsOn?: string[];
  /** 条件付きエッジ: success(既定) / failure / any */
  dependsCondition?: 'success' | 'failure' | 'any';
  /** グラフGUIエディタ用の座標 */
  graphPos?: { x: number; y: number };
}

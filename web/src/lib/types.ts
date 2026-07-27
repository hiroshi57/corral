// フロント側の型（サーバの types.ts と対応）
export type SessionStatus =
  | 'queued'
  | 'running'
  | 'needs_review'
  | 'done'
  | 'error'
  | 'stopped';

export type AgentKind = 'claude' | 'codex' | 'gemini' | 'aider' | 'custom';

export interface LogLine {
  ts: number;
  stream: 'stdout' | 'stderr' | 'system';
  text: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  runs: number;
}

export interface SessionSummary {
  id: string;
  title: string;
  agent: AgentKind;
  prompt: string;
  status: SessionStatus;
  worktreePath: string | null;
  branch: string | null;
  autoAccept: boolean;
  createdAt: number;
  updatedAt: number;
  exitCode: number | null;
  changedFiles: number;
  turns?: string[];
  pendingFollowups?: string[];
  usage: Usage;
  interventions: number;
  durationMs: number;
}

export interface NotifyEvent {
  ts: number;
  sessionId: string;
  title: string;
  status: SessionStatus;
  channels: string[];
  message: string;
}

export type ServerEvent =
  | { type: 'snapshot'; sessions: SessionSummary[] }
  | { type: 'session:update'; session: SessionSummary }
  | { type: 'session:removed'; id: string }
  | { type: 'log'; id: string; line: LogLine }
  | { type: 'notify'; event: NotifyEvent }
  | { type: 'budget'; level: 'alert' | 'exceeded'; totalUsd: number; budgetUsd: number };

export interface FinopsSummary {
  totalUsd: number;
  budgetUsd: number;
  alertRatio: number;
  hardCap: boolean;
  byAgent: Record<
    string,
    { costUsd: number; inputTokens: number; outputTokens: number; sessions: number }
  >;
}

export const STATUS_META: Record<
  SessionStatus,
  { label: string; color: string; dot: string }
> = {
  queued: { label: '起動待ち', color: 'text-slate-300', dot: 'bg-slate-400' },
  running: { label: '実行中', color: 'text-sky-300', dot: 'bg-sky-400 animate-pulse' },
  needs_review: { label: '要確認', color: 'text-amber-300', dot: 'bg-amber-400' },
  done: { label: '完了', color: 'text-emerald-300', dot: 'bg-emerald-400' },
  error: { label: 'エラー', color: 'text-rose-300', dot: 'bg-rose-500' },
  stopped: { label: '停止', color: 'text-slate-400', dot: 'bg-slate-500' },
};

export const AGENT_LABEL: Record<AgentKind, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  gemini: 'Gemini CLI',
  aider: 'Aider',
  custom: 'カスタム',
};

// セッション（ワーカー）のライフサイクル管理
import { EventEmitter } from 'node:events';
import { nanoid } from 'nanoid';
import { config } from '../config.js';
import {
  createWorktree,
  removeWorktree,
  countChanges,
  getDiff,
  checkpoint,
} from '../git/worktree.js';
import { createRunner, type Runner } from './runner.js';
import type {
  AgentKind,
  CreateSessionInput,
  LogLine,
  Session,
  SessionStatus,
  SessionSummary,
} from '../types.js';

const AGENT_LABEL: Record<AgentKind, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
  aider: 'Aider',
  custom: 'カスタム',
};

export class SessionManager extends EventEmitter {
  private sessions = new Map<string, Session>();
  private runners = new Map<string, Runner>();

  list(): SessionSummary[] {
    return [...this.sessions.values()].map(toSummary);
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  /** 台数指定で複数セッションを一括作成（uzi の --agents claude:3 相当） */
  async createBatch(input: CreateSessionInput): Promise<SessionSummary[]> {
    const count = Math.max(1, Math.min(input.count ?? 1, 10));
    const created: SessionSummary[] = [];
    for (let i = 0; i < count; i++) {
      created.push(await this.createOne(input, count > 1 ? i + 1 : undefined));
    }
    return created;
  }

  private async createOne(input: CreateSessionInput, index?: number): Promise<SessionSummary> {
    const id = nanoid(8);
    const now = Date.now();
    const label = AGENT_LABEL[input.agent] ?? input.agent;
    const title =
      input.title?.trim() ||
      `${label}${index ? ` #${index}` : ''}: ${input.prompt.slice(0, 24)}`;

    const session: Session = {
      id,
      title,
      agent: input.agent,
      prompt: input.prompt,
      status: 'queued',
      worktreePath: null,
      branch: null,
      autoAccept: input.autoAccept ?? false,
      createdAt: now,
      updatedAt: now,
      exitCode: null,
      changedFiles: 0,
      logs: [],
    };
    this.sessions.set(id, session);
    this.emitUpdate(session);

    // worktree 作成 → 実行開始
    try {
      const { worktreePath, branch } = await createWorktree(id);
      session.worktreePath = worktreePath;
      session.branch = branch;
      this.appendLog(session, 'system', `worktree を作成: ${branch}`);
      this.startRunner(session);
    } catch (err) {
      this.appendLog(session, 'system', `worktree 作成に失敗: ${(err as Error).message}`);
      this.setStatus(session, 'error');
    }
    return toSummary(session);
  }

  private startRunner(session: Session): void {
    this.setStatus(session, 'running');
    const runner = createRunner(
      session.agent,
      session.prompt,
      session.autoAccept,
      session.worktreePath!
    );
    this.runners.set(session.id, runner);

    runner.on('output', (stream, text) => {
      for (const line of text.split(/\r?\n/)) {
        if (line.length > 0) this.appendLog(session, stream, line);
      }
    });

    runner.on('exit', async (code) => {
      session.exitCode = code;
      session.changedFiles = await countChanges(session.worktreePath!);
      this.runners.delete(session.id);
      if (code === null) {
        this.setStatus(session, 'stopped');
      } else if (code !== 0) {
        this.appendLog(session, 'system', `異常終了（code=${code}）`);
        this.setStatus(session, 'error');
      } else if (session.autoAccept) {
        // 自動承認：そのまま checkpoint
        await this.approve(session.id, `corral: ${session.title}`);
      } else {
        this.setStatus(session, 'needs_review');
      }
    });
  }

  /** 追加指示（個別 / broadcast から呼ばれる） */
  instruct(id: string, text: string): boolean {
    const session = this.sessions.get(id);
    const runner = this.runners.get(id);
    if (!session) return false;
    this.appendLog(session, 'system', `指示: ${text}`);
    if (runner) {
      runner.send(text);
      return true;
    }
    // 停止済みなら再実行（差し戻し）
    session.prompt = text;
    this.startRunner(session);
    return true;
  }

  /** 全ワーカー（または対象）へ一斉指示（uzi broadcast） */
  broadcast(text: string, targetIds?: string[]): number {
    const ids = targetIds ?? [...this.sessions.keys()];
    let n = 0;
    for (const id of ids) if (this.instruct(id, text)) n++;
    return n;
  }

  /** 承認 = commit して完了 */
  async approve(id: string, message: string): Promise<boolean> {
    const session = this.sessions.get(id);
    if (!session?.worktreePath) return false;
    const { committed } = await checkpoint(session.worktreePath, message);
    this.appendLog(
      session,
      'system',
      committed ? `承認：変更を commit しました` : `承認：commit 対象の変更はありませんでした`
    );
    this.setStatus(session, 'done');
    return true;
  }

  async diff(id: string): Promise<string> {
    const session = this.sessions.get(id);
    if (!session?.worktreePath) return '';
    return getDiff(session.worktreePath);
  }

  stop(id: string): boolean {
    const runner = this.runners.get(id);
    if (runner) runner.stop();
    return !!runner;
  }

  /** 破棄：worktree ごと削除 */
  async remove(id: string): Promise<boolean> {
    const session = this.sessions.get(id);
    if (!session) return false;
    this.runners.get(id)?.stop();
    this.runners.delete(id);
    if (session.worktreePath) await removeWorktree(session.worktreePath, session.branch);
    this.sessions.delete(id);
    this.emit('event', { type: 'session:removed', id });
    return true;
  }

  // --- 内部ヘルパ ---
  private setStatus(session: Session, status: SessionStatus): void {
    session.status = status;
    session.updatedAt = Date.now();
    this.emitUpdate(session);
  }

  private appendLog(session: Session, stream: LogLine['stream'], text: string): void {
    const line: LogLine = { ts: Date.now(), stream, text };
    session.logs.push(line);
    if (session.logs.length > config.maxLogLines) session.logs.shift();
    session.updatedAt = line.ts;
    this.emit('event', { type: 'log', id: session.id, line });
  }

  private emitUpdate(session: Session): void {
    this.emit('event', { type: 'session:update', session: toSummary(session) });
  }
}

function toSummary(s: Session): SessionSummary {
  const { logs, ...rest } = s;
  return rest;
}

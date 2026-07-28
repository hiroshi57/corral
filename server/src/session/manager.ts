// セッション（ワーカー）のライフサイクル管理
import { EventEmitter } from 'node:events';
import { nanoid } from 'nanoid';
import { config } from '../config.js';
import {
  createWorktree,
  removeWorktree,
  countChanges,
  changedFilePaths,
  getDiff,
  checkpoint,
} from '../git/worktree.js';
import { createRunner, type Runner } from './runner.js';
import { getProfile } from '../agents/registry.js';
import { accrueRun, emptyUsage } from '../finops/pricing.js';
import { notify } from '../notify/notifier.js';
import { repoStore } from '../tenancy/repos.js';
import { checkPrompt, scanSecrets, checkChanges } from '../guardrails/policy.js';
import { audit } from '../audit/log.js';
import type {
  AgentKind,
  CreateSessionInput,
  GuardrailViolation,
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
  /** run 開始時刻（duration 計測用） */
  private runStart = new Map<string, number>();
  /** run 中の出力文字数（本番のトークン概算用） */
  private runOutChars = new Map<string, number>();

  /** ④ ワークスペース(案件)で絞り込み。未指定なら全件 */
  list(workspaceId?: string): SessionSummary[] {
    return [...this.sessions.values()]
      .filter((s) => !workspaceId || s.workspaceId === workspaceId)
      .map(toSummary);
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  /** セッションが指定ワークスペースに属するか */
  belongsTo(id: string, workspaceId: string): boolean {
    return this.sessions.get(id)?.workspaceId === workspaceId;
  }

  /** 台数指定で複数セッションを一括作成（uzi の --agents claude:3 相当） */
  async createBatch(input: CreateSessionInput, workspaceId: string): Promise<SessionSummary[]> {
    // ② 予算ハードキャップ到達時は新規起動を止める
    if (this.budgetBlocked()) {
      this.checkBudget();
      throw new Error('予算上限（ハードキャップ）に達したため新規起動を停止しました');
    }
    const count = Math.max(1, Math.min(input.count ?? 1, 10));
    const created: SessionSummary[] = [];
    for (let i = 0; i < count; i++) {
      created.push(await this.createOne(input, workspaceId, count > 1 ? i + 1 : undefined));
    }
    return created;
  }

  private async createOne(
    input: CreateSessionInput,
    workspaceId: string,
    index?: number
  ): Promise<SessionSummary> {
    const id = nanoid(8);
    const now = Date.now();
    const label = AGENT_LABEL[input.agent] ?? input.agent;
    const title =
      input.title?.trim() || `${label}${index ? ` #${index}` : ''}: ${input.prompt.slice(0, 24)}`;

    const session: Session = {
      id,
      title,
      agent: input.agent,
      prompt: input.prompt,
      status: 'queued',
      workspaceId,
      repoId: input.repoId ?? null,
      violations: [],
      worktreePath: null,
      branch: null,
      autoAccept: input.autoAccept ?? false,
      createdAt: now,
      updatedAt: now,
      exitCode: null,
      changedFiles: 0,
      turns: [input.prompt],
      pendingFollowups: [],
      usage: emptyUsage(),
      interventions: 0,
      durationMs: 0,
      logs: [],
    };
    this.sessions.set(id, session);
    this.emitUpdate(session);

    // #20 ガードレール: 起動前にプロンプトを検査（禁止コマンド等はブロック）
    const promptViolations = checkPrompt(input.prompt);
    if (promptViolations.some((v) => v.blocked)) {
      promptViolations.forEach((v) => this.recordViolation(session, v));
      this.appendLog(session, 'system', 'ガードレールによりタスクを起動しませんでした');
      this.setStatus(session, 'error');
      return toSummary(session);
    }

    // #4 マルチリポ: 対象リポジトリを解決
    const repo = input.repoId ? repoStore.get(input.repoId) : undefined;
    const repoRoot = repo?.path ?? config.repoRoot;
    try {
      const { worktreePath, branch } = await createWorktree(id, repoRoot);
      session.worktreePath = worktreePath;
      session.branch = branch;
      this.appendLog(session, 'system', `worktree を作成: ${branch}（repo: ${repo?.name ?? 'default'}）`);
      this.startRun(session, session.prompt, false);
    } catch (err) {
      this.appendLog(session, 'system', `worktree 作成に失敗: ${(err as Error).message}`);
      this.setStatus(session, 'error');
    }
    return toSummary(session);
  }

  /** #20 違反を記録して UI へ通知 */
  private recordViolation(session: Session, v: GuardrailViolation): void {
    session.violations.push(v);
    this.appendLog(session, 'system', `🛡 ガードレール: ${v.detail}${v.blocked ? '（ブロック）' : '（警告）'}`);
    this.emit('event', { type: 'guardrail', sessionId: session.id, violation: v });
    // 監査ログにも記録（SIEM 連携対象）
    audit.record({
      actorId: 'system',
      actorEmail: 'guardrail',
      action: `guardrail.${v.kind}`,
      workspaceId: session.workspaceId,
      target: session.id,
      outcome: v.blocked ? 'denied' : 'error',
      detail: v.detail,
    });
  }

  private repoRootOf(session: Session): string {
    const repo = session.repoId ? repoStore.get(session.repoId) : undefined;
    return repo?.path ?? config.repoRoot;
  }

  /**
   * 1回の run を開始する。
   * @param text この run に渡すプロンプト（初回=タスク、継続=追加指示 or 文脈結合文）
   * @param isFollowup 継続run か
   */
  private startRun(session: Session, text: string, isFollowup: boolean): void {
    this.setStatus(session, 'running');
    this.runStart.set(session.id, Date.now());
    this.runOutChars.set(session.id, 0);
    const runner = createRunner(
      session.agent,
      text,
      session.autoAccept,
      session.worktreePath!,
      isFollowup
    );
    this.runners.set(session.id, runner);

    runner.on('output', (stream, chunk) => {
      this.runOutChars.set(session.id, (this.runOutChars.get(session.id) ?? 0) + chunk.length);
      // #20 出力の機密スキャン（検出→記録＆ログはマスキング）
      const { violations, redacted } = scanSecrets(chunk);
      violations.forEach((v) => this.recordViolation(session, v));
      for (const line of redacted.split(/\r?\n/)) {
        if (line.length > 0) this.appendLog(session, stream, line);
      }
    });

    runner.on('exit', async (code) => {
      this.runners.delete(session.id);
      session.exitCode = code;
      session.changedFiles = await countChanges(session.worktreePath!);

      // ② FinOps: この run の使用量とコスト、③ 所要時間を加算
      const started = this.runStart.get(session.id) ?? Date.now();
      session.durationMs += Date.now() - started;
      session.usage = accrueRun(session.usage, session.agent, {
        demo: config.demo,
        outputChars: this.runOutChars.get(session.id) ?? 0,
      });
      this.runStart.delete(session.id);
      this.runOutChars.delete(session.id);
      this.checkBudget();

      // 実行中に届いた追加指示があれば、まず継続runとして消化する
      if (code !== null && session.pendingFollowups.length > 0) {
        const next = session.pendingFollowups.shift()!;
        this.appendLog(session, 'system', `継続: ${next}`);
        this.startRun(session, this.followupText(session, next), true);
        return;
      }

      if (code === null) {
        this.setStatus(session, 'stopped');
      } else if (code !== 0) {
        this.appendLog(session, 'system', `異常終了（code=${code}）`);
        this.setStatus(session, 'error');
      } else if (session.autoAccept) {
        await this.approve(session.id, `corral: ${session.title}`);
      } else {
        this.setStatus(session, 'needs_review');
      }
    });
  }

  /**
   * 継続runへ渡す文言を作る。
   * ネイティブに会話継続できるエージェント（claude/codex）は追加指示だけを渡す。
   * できないエージェントは、過去の指示を文脈として結合して渡す（文脈欠落を防ぐ）。
   */
  private followupText(session: Session, instruction: string): string {
    if (getProfile(session.agent).nativeResume) return instruction;
    const history = session.turns.slice(0, -1); // 末尾=今回の指示
    const past = history.map((t, i) => `${i + 1}. ${t}`).join('\n');
    return `これまでの指示:\n${past}\n\n最新の追加指示:\n${instruction}\n\n上記の文脈を踏まえて作業を継続してください。`;
  }

  /**
   * 追加指示。実行中ならキューに積み、現ランの終了後に継続runとして流す。
   * 停止/完了済みなら即座に継続runを開始する。
   * ※ stdin 注入はしない（ワンショットCLIでは無効なため）。
   */
  instruct(id: string, text: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;

    // #20 追加指示もガードレール検査（禁止コマンドはブロック）
    const violations = checkPrompt(text);
    if (violations.some((v) => v.blocked)) {
      violations.forEach((v) => this.recordViolation(session, v));
      return false;
    }

    session.turns.push(text);
    session.interventions += 1; // ③ 人手介入としてカウント

    if (this.runners.has(id)) {
      session.pendingFollowups.push(text);
      this.appendLog(session, 'system', `指示を受付（実行中のため完了後に継続）: ${text}`);
      this.emitUpdate(session);
      return true;
    }
    this.appendLog(session, 'system', `指示: ${text}`);
    this.startRun(session, this.followupText(session, text), true);
    return true;
  }

  /** 全ワーカー（または対象）へ一斉指示（uzi broadcast） */
  broadcast(text: string, targetIds?: string[]): number {
    const ids = targetIds ?? [...this.sessions.keys()];
    let n = 0;
    for (const id of ids) if (this.instruct(id, text)) n++;
    return n;
  }

  /** 承認 = commit して完了。#20 保護パス/大量変更はブロック */
  async approve(id: string, message: string): Promise<boolean> {
    const session = this.sessions.get(id);
    if (!session?.worktreePath) return false;

    // #20 ガードレール: 変更内容を承認前に検査
    const files = await changedFilePaths(session.worktreePath);
    const changeViolations = checkChanges(files, session.changedFiles);
    if (changeViolations.some((v) => v.blocked)) {
      changeViolations.forEach((v) => this.recordViolation(session, v));
      this.appendLog(session, 'system', '承認をブロックしました（ガードレール違反）。手動確認が必要です。');
      return false;
    }

    const { committed, count } = await checkpoint(session.worktreePath, message);
    this.appendLog(
      session,
      'system',
      committed
        ? `承認：${count} 件の変更を記録（commit）しました`
        : `承認：記録対象の変更はありませんでした`
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

  async remove(id: string): Promise<boolean> {
    const session = this.sessions.get(id);
    if (!session) return false;
    this.runners.get(id)?.stop();
    this.runners.delete(id);
    if (session.worktreePath)
      await removeWorktree(session.worktreePath, session.branch, this.repoRootOf(session));
    this.sessions.delete(id);
    this.emit('event', { type: 'session:removed', id });
    return true;
  }

  /** ② FinOps サマリ（API 用）。④ ワークスペースで絞り込み可 */
  finopsSummary(workspaceId?: string) {
    const sessions = [...this.sessions.values()].filter(
      (s) => !workspaceId || s.workspaceId === workspaceId
    );
    const total = sessions.reduce((a, s) => a + s.usage.costUsd, 0);
    const byAgent: Record<string, { costUsd: number; inputTokens: number; outputTokens: number; sessions: number }> = {};
    for (const s of sessions) {
      const k = s.agent;
      byAgent[k] ??= { costUsd: 0, inputTokens: 0, outputTokens: 0, sessions: 0 };
      byAgent[k].costUsd += s.usage.costUsd;
      byAgent[k].inputTokens += s.usage.inputTokens;
      byAgent[k].outputTokens += s.usage.outputTokens;
      byAgent[k].sessions += 1;
    }
    return {
      totalUsd: total,
      budgetUsd: config.finops.budgetUsd,
      alertRatio: config.finops.alertRatio,
      hardCap: config.finops.hardCap,
      byAgent,
    };
  }

  private totalCost(): number {
    let t = 0;
    for (const s of this.sessions.values()) t += s.usage.costUsd;
    return t;
  }

  /** 予算判定してアラート/超過イベントを発火 */
  private checkBudget(): void {
    const budget = config.finops.budgetUsd;
    if (!budget) return;
    const total = this.totalCost();
    if (total >= budget) {
      this.emit('event', { type: 'budget', level: 'exceeded', totalUsd: total, budgetUsd: budget });
    } else if (total >= budget * config.finops.alertRatio) {
      this.emit('event', { type: 'budget', level: 'alert', totalUsd: total, budgetUsd: budget });
    }
  }

  /** 予算ハードキャップに達しているか（新規作成の抑止用） */
  private budgetBlocked(): boolean {
    const budget = config.finops.budgetUsd;
    return !!budget && config.finops.hardCap && this.totalCost() >= budget;
  }

  // --- 内部ヘルパ ---
  private setStatus(session: Session, status: SessionStatus): void {
    session.status = status;
    session.updatedAt = Date.now();
    this.emitUpdate(session);
    // ① 節目のステータスは通知（設定チャネル＋アプリ内）
    if (config.notify.events.includes(status)) {
      void this.dispatchNotify(session);
    }
  }

  private async dispatchNotify(session: Session): Promise<void> {
    const event = await notify({
      sessionId: session.id,
      title: session.title,
      status: session.status,
      branch: session.branch,
      demo: config.demo,
    });
    this.appendLog(session, 'system', `通知送信: ${event.channels.join(', ')}`);
    this.emit('event', { type: 'notify', event });
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

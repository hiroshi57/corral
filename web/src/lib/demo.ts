// ブラウザ内デモバックエンド
//
// バックエンド（デーモン）が無い環境（Vercel 静的配信など）でも、
// 司令塔→一括起動→broadcast→差分レビュー→承認 の UX を体験できるよう、
// サーバの SessionManager 相当をブラウザ内で疑似再現する。
// ※ 実エージェント起動・git worktree・commit は行わない（UI 確認専用）。
import type {
  AgentKind,
  LogLine,
  ServerEvent,
  SessionStatus,
  SessionSummary,
} from './types';

interface DemoSession extends SessionSummary {
  turns: string[];
  pendingFollowups: string[];
  logs: LogLine[];
  timers: number[];
}

const AGENT_LABEL: Record<AgentKind, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
  aider: 'Aider',
  custom: 'カスタム',
};

let counter = 0;
const id8 = () => `d${(++counter).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

class DemoBackend {
  private sessions = new Map<string, DemoSession>();
  private subs = new Set<(e: ServerEvent) => void>();

  subscribe(fn: (e: ServerEvent) => void): () => void {
    this.subs.add(fn);
    fn({ type: 'snapshot', sessions: this.list() });
    return () => this.subs.delete(fn);
  }

  private emit(e: ServerEvent): void {
    for (const fn of this.subs) fn(e);
  }

  list(): SessionSummary[] {
    return [...this.sessions.values()].map(toSummary);
  }

  getSession(id: string) {
    const s = this.sessions.get(id);
    return s ? { ...toSummary(s), logs: s.logs } : null;
  }

  createSessions(input: {
    agent: AgentKind;
    prompt: string;
    count?: number;
    autoAccept?: boolean;
    title?: string;
  }): SessionSummary[] {
    const count = Math.max(1, Math.min(input.count ?? 1, 10));
    const created: SessionSummary[] = [];
    for (let i = 0; i < count; i++) {
      const id = id8();
      const now = Date.now();
      const label = AGENT_LABEL[input.agent] ?? input.agent;
      const s: DemoSession = {
        id,
        title:
          input.title?.trim() ||
          `${label}${count > 1 ? ` #${i + 1}` : ''}: ${input.prompt.slice(0, 24)}`,
        agent: input.agent,
        prompt: input.prompt,
        status: 'queued',
        worktreePath: `/(demo)/.corral/worktrees/${id}`,
        branch: `corral/${id}`,
        autoAccept: input.autoAccept ?? false,
        createdAt: now,
        updatedAt: now,
        exitCode: null,
        changedFiles: 0,
        turns: [input.prompt],
        pendingFollowups: [],
        logs: [],
        timers: [],
      };
      this.sessions.set(id, s);
      this.update(s);
      this.log(s, 'system', `worktree を作成: ${s.branch}`);
      this.run(s, input.prompt, false);
      created.push(toSummary(s));
    }
    return created;
  }

  instruct(id: string, text: string): { ok: boolean } {
    const s = this.sessions.get(id);
    if (!s) return { ok: false };
    s.turns.push(text);
    if (s.status === 'running') {
      s.pendingFollowups.push(text);
      this.log(s, 'system', `指示を受付（実行中のため完了後に継続）: ${text}`);
      this.update(s);
    } else {
      this.log(s, 'system', `指示: ${text}`);
      this.run(s, text, true);
    }
    return { ok: true };
  }

  broadcast(text: string, targetIds?: string[]): { delivered: number } {
    const ids = targetIds ?? [...this.sessions.keys()];
    let n = 0;
    for (const id of ids) if (this.instruct(id, text).ok) n++;
    return { delivered: n };
  }

  diff(id: string): { diff: string } {
    const s = this.sessions.get(id);
    if (!s || s.changedFiles === 0) return { diff: '変更はありません' };
    const parts: string[] = [];
    for (let n = 1; n <= s.changedFiles; n++) {
      parts.push(
        `diff --corral a/demo_change_${n}.txt b/demo_change_${n}.txt\n` +
          `+++ demo_change_${n}.txt\n+# 変更 ${n}\n+指示: ${s.turns[Math.min(n - 1, s.turns.length - 1)]}\n`
      );
    }
    return { diff: parts.join('\n\n') };
  }

  approve(id: string): { ok: boolean } {
    const s = this.sessions.get(id);
    if (!s) return { ok: false };
    this.log(
      s,
      'system',
      s.changedFiles > 0
        ? `承認：${s.changedFiles} 件の変更を記録（commit）しました`
        : `承認：記録対象の変更はありませんでした`
    );
    this.setStatus(s, 'done');
    return { ok: true };
  }

  stop(id: string): { ok: boolean } {
    const s = this.sessions.get(id);
    if (!s) return { ok: false };
    s.timers.forEach((t) => clearTimeout(t));
    s.timers = [];
    if (s.status === 'running') this.setStatus(s, 'stopped');
    return { ok: true };
  }

  remove(id: string): { ok: boolean } {
    const s = this.sessions.get(id);
    if (s) s.timers.forEach((t) => clearTimeout(t));
    const ok = this.sessions.delete(id);
    if (ok) this.emit({ type: 'session:removed', id });
    return { ok };
  }

  // --- 内部 ---
  private run(s: DemoSession, text: string, isFollowup: boolean): void {
    this.setStatus(s, 'running');
    const label = AGENT_LABEL[s.agent];
    const steps: Array<() => void> = [
      () => this.log(s, 'stdout', `${label} を worktree で起動しました。`),
      () => this.log(s, 'stdout', `${isFollowup ? '継続タスク' : 'タスク'}を解析中: 「${text}」`),
      () => {
        s.changedFiles += 1;
        this.log(s, 'stdout', `ファイル demo_change_${s.changedFiles}.txt を生成しました。`);
      },
      () => this.log(s, 'stdout', '変更を適用しました。人間のレビューを待ちます。'),
    ];
    steps.forEach((fn, i) => {
      const t = window.setTimeout(() => {
        fn();
        if (i === steps.length - 1) this.onExit(s);
      }, 600 * (i + 1));
      s.timers.push(t);
    });
  }

  private onExit(s: DemoSession): void {
    if (s.pendingFollowups.length > 0) {
      const next = s.pendingFollowups.shift()!;
      this.log(s, 'system', `継続: ${next}`);
      this.run(s, next, true);
      return;
    }
    if (s.autoAccept) this.approve(s.id);
    else this.setStatus(s, 'needs_review');
  }

  private setStatus(s: DemoSession, status: SessionStatus): void {
    s.status = status;
    s.updatedAt = Date.now();
    this.update(s);
  }

  private log(s: DemoSession, stream: LogLine['stream'], text: string): void {
    const line: LogLine = { ts: Date.now(), stream, text };
    s.logs.push(line);
    if (s.logs.length > 1000) s.logs.shift();
    s.updatedAt = line.ts;
    this.emit({ type: 'log', id: s.id, line });
  }

  private update(s: DemoSession): void {
    this.emit({ type: 'session:update', session: toSummary(s) });
  }
}

function toSummary(s: DemoSession): SessionSummary {
  const { logs, timers, ...rest } = s;
  void logs;
  void timers;
  return rest;
}

export const demoBackend = new DemoBackend();

/** デモモード判定：ビルドフラグ or URL ?demo=1 */
export const IS_DEMO =
  import.meta.env.VITE_CORRAL_DEMO === '1' ||
  (typeof location !== 'undefined' && new URLSearchParams(location.search).has('demo'));

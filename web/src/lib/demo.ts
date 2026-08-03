// ブラウザ内デモバックエンド
//
// バックエンド（デーモン）が無い環境（Vercel 静的配信など）でも、
// 司令塔→一括起動→broadcast→差分レビュー→承認 の UX を体験できるよう、
// サーバの SessionManager 相当をブラウザ内で疑似再現する。
// ※ 実エージェント起動・git worktree・commit は行わない（UI 確認専用）。
import type {
  AgentKind,
  FinopsSummary,
  GuardrailViolation,
  LogLine,
  Repo,
  ServerEvent,
  SessionStatus,
  SessionSummary,
  Usage,
} from './types';
import type { AuditEvent, DetectedAgent, Member, SearchHit } from './types';
import type { Role, User, WorkspaceInfo } from './auth';

// #20 デモ用ガードレール（サーバの denyCommands と同等の代表例）
const DENY = [/rm\s+-rf\s+\//i, /git\s+push\s+--force/i, /DROP\s+TABLE/i, /curl\s+[^|]*\|\s*(ba)?sh/i];
function demoCheckPrompt(text: string): GuardrailViolation[] {
  return DENY.filter((re) => re.test(text)).map((re) => ({
    ts: Date.now(),
    kind: 'deny-command' as const,
    detail: `禁止コマンド検出: ${re.source}`,
    blocked: true,
  }));
}

interface DemoSession extends SessionSummary {
  turns: string[];
  pendingFollowups: string[];
  logs: LogLine[];
  timers: number[];
  runStartTs: number;
}

const AGENT_LABEL: Record<AgentKind, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
  aider: 'Aider',
  custom: 'カスタム',
};

// ② FinOps: 参考単価（サーバの DEFAULT_PRICING と同値・1MトークンあたりUSD）
const PRICING: Record<AgentKind, { i: number; o: number }> = {
  claude: { i: 3, o: 15 },
  codex: { i: 2.5, o: 10 },
  gemini: { i: 1.25, o: 5 },
  aider: { i: 2.5, o: 10 },
  custom: { i: 0, o: 0 },
};

const NOTIFY_EVENTS: SessionStatus[] = ['needs_review', 'done', 'error', 'stopped'];

let counter = 0;
const id8 = () => `d${(++counter).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

class DemoBackend {
  private sessions = new Map<string, DemoSession>();
  private subs = new Set<(e: ServerEvent) => void>();

  // ④ ワークスペース（案件）
  private workspaces: Array<{ id: string; name: string; createdAt: number; ownerId: string }> = [
    { id: 'default', name: 'サンプル案件', createdAt: Date.now(), ownerId: 'demo' },
  ];
  // #4 マルチリポ（案件が複数リポを持つ例）
  private repos: Repo[] = [
    { id: 'r-web', name: 'web', path: '/demo/web', workspaceId: 'default' },
    { id: 'r-api', name: 'api', path: '/demo/api', workspaceId: 'default' },
  ];

  listRepos(workspaceId: string): Repo[] {
    return this.repos.filter((r) => r.workspaceId === workspaceId);
  }

  // 監査ログ（デモはクライアント内で記録）
  private auditLog: AuditEvent[] = [];
  private auditPrev = 'genesis';
  private recordAudit(action: string, outcome: AuditEvent['outcome'], target: string | null, detail?: string) {
    const e: AuditEvent = {
      ts: Date.now(),
      actorId: this.user.id,
      actorEmail: this.user.email,
      action,
      workspaceId: this.workspaces[0]?.id ?? 'default',
      target,
      outcome,
      detail,
      prevHash: this.auditPrev,
      hash: (this.auditPrev + action + Date.now()).length.toString(16) + Math.random().toString(16).slice(2, 8),
    };
    this.auditPrev = e.hash!;
    this.auditLog.push(e);
    if (this.auditLog.length > 2000) this.auditLog.shift();
  }
  audit(): { siemConnected: boolean; events: AuditEvent[] } {
    return { siemConnected: false, events: [...this.auditLog].slice(-500).reverse() };
  }

  // メンバー管理（デモ）
  private members: Member[] = [
    { id: 'demo', email: 'demo@corral', name: 'デモユーザー', provider: 'demo', role: 'owner' },
  ];
  listMembers(): Member[] {
    return this.members.map((m) => (m.id === this.user.id ? { ...m, role: this.role } : m));
  }
  addMember(email: string, name: string, role: Role): Member {
    const existing = this.members.find((m) => m.email === email);
    if (existing) {
      existing.role = role;
      return existing;
    }
    const m: Member = { id: id8(), email, name: name || email, provider: 'invited', role };
    this.members.push(m);
    this.recordAudit('member.add', 'success', m.id, `${email} as ${role}`);
    return m;
  }
  // ⑤ デモユーザー＆ロール（UI でロール切替して RBAC を体験できる）
  private user: User = { id: 'demo', email: 'demo@corral', name: 'デモユーザー', provider: 'demo' };
  private role: Role = 'owner';

  getRole(): Role {
    return this.role;
  }
  setRole(r: Role): void {
    this.role = r;
  }

  loginDev(email: string, name?: string): { token: string; user: User } {
    this.user = { id: 'demo', email, name: name || email.split('@')[0], provider: 'demo' };
    return { token: 'demo-session', user: this.user };
  }

  me(): { user: User; workspaces: WorkspaceInfo[] } {
    return { user: this.user, workspaces: this.listWorkspaces() };
  }

  listWorkspaces(): WorkspaceInfo[] {
    return this.workspaces.map((w) => ({ ...w, role: this.role }));
  }

  createWorkspace(name: string): WorkspaceInfo {
    const ws = { id: id8(), name, createdAt: Date.now(), ownerId: this.user.id };
    this.workspaces.push(ws);
    this.repos.push({ id: id8(), name: 'main', path: `/demo/${ws.id}`, workspaceId: ws.id });
    return { ...ws, role: 'owner' };
  }

  subscribe(fn: (e: ServerEvent) => void): () => void {
    this.subs.add(fn);
    fn({ type: 'snapshot', sessions: this.list() });
    return () => this.subs.delete(fn);
  }

  private emit(e: ServerEvent): void {
    for (const fn of this.subs) fn(e);
  }

  list(workspaceId?: string): SessionSummary[] {
    return [...this.sessions.values()]
      .filter((s) => !workspaceId || s.workspaceId === workspaceId)
      .map(toSummary);
  }

  getSession(id: string) {
    const s = this.sessions.get(id);
    return s ? { ...toSummary(s), logs: s.logs } : null;
  }

  createSessions(
    input: {
      agent: AgentKind;
      prompt: string;
      count?: number;
      autoAccept?: boolean;
      title?: string;
      repoId?: string;
      dependsOn?: string[];
      dependsCondition?: 'success' | 'failure' | 'any';
      graphPos?: { x: number; y: number };
    },
    workspaceId = 'default'
  ): SessionSummary[] {
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
        workspaceId,
        repoId: input.repoId ?? this.repos.find((r) => r.workspaceId === workspaceId)?.id ?? null,
        dependsOn: input.dependsOn ?? [],
        dependsCondition: input.dependsCondition ?? 'success',
        graphPos: input.graphPos,
        violations: [],
        worktreePath: `/(demo)/.corral/worktrees/${id}`,
        branch: `corral/${id}`,
        autoAccept: input.autoAccept ?? false,
        createdAt: now,
        updatedAt: now,
        exitCode: null,
        changedFiles: 0,
        turns: [input.prompt],
        pendingFollowups: [],
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, runs: 0 },
        interventions: 0,
        durationMs: 0,
        logs: [],
        timers: [],
        runStartTs: 0,
      };
      this.sessions.set(id, s);
      this.update(s);
      // #20 ガードレール: 危険プロンプトは起動前にブロック
      const violations = demoCheckPrompt(input.prompt);
      if (violations.length) {
        violations.forEach((v) => this.addViolation(s, v));
        this.log(s, 'system', 'ガードレールによりタスクを起動しませんでした');
        this.setStatus(s, 'error');
        created.push(toSummary(s));
        continue;
      }
      const repoName = this.repos.find((r) => r.id === s.repoId)?.name ?? 'default';
      this.log(s, 'system', `worktree を作成: ${s.branch}（repo: ${repoName}）`);
      this.recordAudit('session.create', 'success', s.id, input.prompt.slice(0, 60));
      // #1 依存タスク未完了なら待機
      if (this.depsSatisfied(s)) this.run(s, input.prompt, false);
      else this.log(s, 'system', `依存タスクの完了待ち: ${s.dependsOn?.join(', ')}`);
      created.push(toSummary(s));
    }
    return created;
  }

  private addViolation(s: DemoSession, v: GuardrailViolation): void {
    s.violations.push(v);
    this.log(s, 'system', `🛡 ガードレール: ${v.detail}${v.blocked ? '（ブロック）' : '（警告）'}`);
    this.emit({ type: 'guardrail', sessionId: s.id, violation: v });
    this.recordAudit(`guardrail.${v.kind}`, v.blocked ? 'denied' : 'error', s.id, v.detail);
  }

  /** 条件付きエッジ: success/failure/any */
  private depsSatisfied(s: DemoSession): boolean {
    const cond = s.dependsCondition ?? 'success';
    return (s.dependsOn ?? []).every((id) => {
      const st = this.sessions.get(id)?.status;
      if (!st) return false;
      if (cond === 'success') return st === 'done';
      if (cond === 'failure') return st === 'error' || st === 'stopped';
      return st === 'done' || st === 'error' || st === 'stopped';
    });
  }

  /** グラフGUIエディタ: 依存/条件/座標を更新（循環防止） */
  updateGraph(
    id: string,
    patch: { dependsOn?: string[]; dependsCondition?: 'success' | 'failure' | 'any'; graphPos?: { x: number; y: number } }
  ): { ok: boolean } {
    const s = this.sessions.get(id);
    if (!s) return { ok: false };
    if (patch.dependsOn) s.dependsOn = patch.dependsOn.filter((d) => d !== id && !this.wouldCycle(id, d));
    if (patch.dependsCondition) s.dependsCondition = patch.dependsCondition;
    if (patch.graphPos) s.graphPos = patch.graphPos;
    s.updatedAt = Date.now();
    this.update(s);
    this.promoteReady();
    return { ok: true };
  }

  private wouldCycle(target: string, dep: string, seen = new Set<string>()): boolean {
    if (dep === target) return true;
    if (seen.has(dep)) return false;
    seen.add(dep);
    return (this.sessions.get(dep)?.dependsOn ?? []).some((x) => this.wouldCycle(target, x, seen));
  }

  /** セッション横断検索 */
  search(query: string, workspaceId?: string): SearchHit[] {
    const q = query.toLowerCase();
    if (!q) return [];
    const out: SearchHit[] = [];
    for (const s of this.sessions.values()) {
      if (workspaceId && s.workspaceId !== workspaceId) continue;
      const hits: string[] = [];
      if (s.title.toLowerCase().includes(q)) hits.push(`タイトル: ${s.title}`);
      for (const t of s.turns) if (t.toLowerCase().includes(q)) hits.push(`指示: ${t.slice(0, 120)}`);
      for (const l of s.logs) {
        if (l.text.toLowerCase().includes(q)) {
          hits.push(`ログ: ${l.text.slice(0, 120)}`);
          if (hits.length > 6) break;
        }
      }
      if (hits.length) out.push({ session: toSummary(s), hits: hits.slice(0, 6) });
    }
    return out.slice(0, 50);
  }

  /** エージェント自動検出（デモは全て利用可能として表示） */
  detectAgents(): DetectedAgent[] {
    return (['claude', 'codex', 'gemini', 'aider'] as const).map((kind) => ({
      kind,
      label: AGENT_LABEL[kind],
      command: kind,
      available: true,
      version: 'demo',
    }));
  }
  private promoteReady(): void {
    for (const s of this.sessions.values()) {
      if (s.status === 'queued' && (s.dependsOn?.length ?? 0) > 0 && this.depsSatisfied(s)) {
        this.log(s, 'system', '依存タスクが完了。開始します。');
        this.run(s, s.prompt, false);
      }
    }
  }

  instruct(id: string, text: string): { ok: boolean } {
    const s = this.sessions.get(id);
    if (!s) return { ok: false };
    s.turns.push(text);
    s.interventions += 1; // ③ 人手介入
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
    s.runStartTs = Date.now();
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
    // ② FinOps: この run の使用量・コスト、③ 所要時間を加算
    const inTok = 1500 + Math.floor(Math.random() * 4000);
    const outTok = 800 + Math.floor(Math.random() * 3000);
    const p = PRICING[s.agent] ?? PRICING.custom;
    const u: Usage = {
      inputTokens: s.usage.inputTokens + inTok,
      outputTokens: s.usage.outputTokens + outTok,
      costUsd: s.usage.costUsd + (inTok / 1_000_000) * p.i + (outTok / 1_000_000) * p.o,
      runs: s.usage.runs + 1,
    };
    s.usage = u;
    if (s.runStartTs) s.durationMs += Date.now() - s.runStartTs;

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
    if (status === 'done' || status === 'error' || status === 'stopped') {
      if (status === 'done') this.recordAudit('session.approve', 'success', s.id);
      this.promoteReady(); // 条件付きエッジ(success/failure/any)で依存待ちを起動
    }
    // ① 通知（デモは外部送信せずアプリ内通知のみ）
    if (NOTIFY_EVENTS.includes(status)) {
      const mark =
        status === 'done' ? '✅' : status === 'error' ? '❌' : status === 'stopped' ? '⏹️' : '👀';
      this.emit({
        type: 'notify',
        event: {
          ts: Date.now(),
          sessionId: s.id,
          title: s.title,
          status,
          channels: ['app'],
          message: `${mark} ${s.title}`,
        },
      });
    }
  }

  /** ② FinOps サマリ（④ 案件スコープ） */
  finops(workspaceId?: string): FinopsSummary {
    const sessions = [...this.sessions.values()].filter(
      (s) => !workspaceId || s.workspaceId === workspaceId
    );
    const totalUsd = sessions.reduce((a, s) => a + s.usage.costUsd, 0);
    const byAgent: FinopsSummary['byAgent'] = {};
    for (const s of sessions) {
      byAgent[s.agent] ??= { costUsd: 0, inputTokens: 0, outputTokens: 0, sessions: 0 };
      byAgent[s.agent].costUsd += s.usage.costUsd;
      byAgent[s.agent].inputTokens += s.usage.inputTokens;
      byAgent[s.agent].outputTokens += s.usage.outputTokens;
      byAgent[s.agent].sessions += 1;
    }
    return { totalUsd, budgetUsd: 0, alertRatio: 0.8, hardCap: false, byAgent };
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
  const { logs, timers, runStartTs, ...rest } = s;
  void logs;
  void timers;
  void runStartTs;
  return rest;
}

export const demoBackend = new DemoBackend();

/** デモモード判定：ビルドフラグ or URL ?demo=1 */
export const IS_DEMO =
  import.meta.env.VITE_CORRAL_DEMO === '1' ||
  (typeof location !== 'undefined' && new URLSearchParams(location.search).has('demo'));

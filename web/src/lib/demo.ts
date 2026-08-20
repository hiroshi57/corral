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
import type { AuditEvent, DetectedAgent, Member, Playbook, SearchHit } from './types';
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

// ③ デモの同時実行上限
const MAX_CONCURRENT = 3;

// ② エージェント自動割当（サーバの assign.ts と同じ方針の簡易版）
function autoAssign(text: string): AgentKind {
  if (/テスト|検証|回帰|E2E|ユニット|品質|lint|CI/.test(text)) return 'codex';
  if (/ドキュメント|README|手順|マニュアル|説明|記載|共有|報告/.test(text)) return 'gemini';
  if (/実装|修正|追加|作成|対応|改善|構築|移行|削除|最適化/.test(text)) return 'codex';
  return 'claude'; // 調査・設計・レビュー・一般
}

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

  createRepo(name: string, path: string, workspaceId: string): Repo {
    const r: Repo = { id: id8(), name, path, workspaceId };
    this.repos.push(r);
    this.recordAudit('repo.create', 'success', r.id, `${name} (${path})`);
    return r;
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
      // #1 依存待ち / ③ 実行スロット待ちは queued のまま
      if (!this.depsSatisfied(s)) {
        this.log(s, 'system', `依存タスクの完了待ち: ${s.dependsOn?.join(', ')}`);
      } else if (!this.hasSlot()) {
        this.log(s, 'system', `実行キュー待ち（同時実行上限 ${MAX_CONCURRENT}）`);
      } else {
        this.run(s, input.prompt, false);
      }
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

  // ① プレイブック（デモ用プリセット + 保存）
  private playbooks: Playbook[] = [
    {
      id: 'pb-feature',
      name: '新機能開発（調査→設計→実装→テスト）',
      description: '調査と設計を並列で行い、実装で合流、最後にテストとドキュメント',
      workspaceId: null,
      builtin: true,
      createdAt: 0,
      nodes: [
        { ref: 1, text: '既存コードと関連仕様を調査し、影響範囲をまとめる', deps: [] },
        { ref: 2, text: 'データ構造とAPIインターフェースを設計する', deps: [] },
        { ref: 3, text: '設計に基づいて機能を実装する', deps: [1, 2] },
        { ref: 4, text: 'ユニットテストと結合テストを追加する', deps: [3] },
        { ref: 5, text: 'README とドキュメントを更新する', deps: [3] },
      ],
    },
    {
      id: 'pb-bugfix',
      name: 'バグ修正（再現→原因→修正→回帰テスト）',
      description: '再現手順の確立から回帰テストまで。修正失敗時のリカバリ経路つき',
      workspaceId: null,
      builtin: true,
      createdAt: 0,
      nodes: [
        { ref: 1, text: 'バグを再現する最小手順とテストを作成する', deps: [] },
        { ref: 2, text: '原因を特定し、根本原因を説明する', deps: [1] },
        { ref: 3, text: '原因に対する修正を実装する', deps: [2] },
        { ref: 4, text: '回帰テストを追加し、既存テストが通ることを確認する', deps: [3] },
        { ref: 5, text: '修正が失敗した場合、別アプローチを検討して再試行する', deps: [3], condition: 'failure' },
      ],
    },
    {
      id: 'pb-refactor',
      name: 'リファクタリング（棚卸し→分割実施→検証）',
      description: '対象の棚卸し後、複数箇所を並列で改善し、最後に検証で合流',
      workspaceId: null,
      builtin: true,
      createdAt: 0,
      nodes: [
        { ref: 1, text: 'リファクタリング対象を棚卸しし、優先順位をつける', deps: [] },
        { ref: 2, text: '重複コードを共通化する', deps: [1] },
        { ref: 3, text: '命名と型定義を整理する', deps: [1] },
        { ref: 4, text: '全体のテストを実行し、挙動が変わらないことを検証する', deps: [2, 3] },
      ],
    },
  ];

  listPlaybooks(): Playbook[] {
    const ws = this.workspaces[0]?.id ?? 'default';
    return this.playbooks.filter((p) => p.workspaceId === null || p.workspaceId === ws);
  }

  savePlaybook(name: string, description?: string, sessionIds?: string[]): Playbook {
    const targets = (sessionIds?.length
      ? sessionIds.map((id) => this.sessions.get(id)).filter((s): s is DemoSession => !!s)
      : [...this.sessions.values()]);
    const idToRef = new Map<string, number>();
    targets.forEach((s, i) => idToRef.set(s.id, i + 1));
    const pb: Playbook = {
      id: id8(),
      name,
      description,
      workspaceId: this.workspaces[0]?.id ?? 'default',
      createdAt: Date.now(),
      nodes: targets.map((s) => ({
        ref: idToRef.get(s.id)!,
        text: s.turns[0] ?? s.prompt,
        deps: (s.dependsOn ?? []).map((d) => idToRef.get(d)).filter((x): x is number => x !== undefined),
        agent: s.agent,
        condition: s.dependsCondition,
      })),
    };
    this.playbooks.push(pb);
    this.recordAudit('playbook.create', 'success', pb.id, `${pb.nodes.length} nodes`);
    return pb;
  }

  deletePlaybook(id: string): { ok: boolean } {
    const p = this.playbooks.find((x) => x.id === id);
    if (!p || p.builtin) return { ok: false };
    this.playbooks = this.playbooks.filter((x) => x.id !== id);
    return { ok: true };
  }

  /** ① プレイブックを展開して実行（② エージェント自動割当つき） */
  runPlaybook(
    id: string,
    opts: { agent?: AgentKind; repoId?: string; autoAccept?: boolean },
    workspaceId = 'default'
  ): SessionSummary[] {
    const pb = this.playbooks.find((p) => p.id === id);
    if (!pb) return [];
    const refToId = new Map<number, string>();
    const created: SessionSummary[] = [];
    const pending = [...pb.nodes];
    let guard = 0;
    while (pending.length && guard++ < 200) {
      const idx = pending.findIndex((n) =>
        n.deps.every((d) => refToId.has(d) || !pb.nodes.some((x) => x.ref === d))
      );
      const node = pending.splice(idx >= 0 ? idx : 0, 1)[0];
      const deps = node.deps.map((d) => refToId.get(d)).filter((x): x is string => !!x);
      const agent = opts.agent ?? node.agent ?? autoAssign(node.text);
      const [s] = this.createSessions(
        {
          agent,
          prompt: node.text,
          count: 1,
          autoAccept: opts.autoAccept,
          repoId: opts.repoId,
          title: node.text.slice(0, 40),
          dependsOn: deps,
          dependsCondition: node.condition ?? 'success',
        },
        workspaceId
      );
      if (s) {
        refToId.set(node.ref, s.id);
        created.push(s);
      }
    }
    this.recordAudit('playbook.run', 'success', pb.id, `${created.length} sessions`);
    return created;
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
  /** ③ 実行中の数（running なセッション） */
  private hasSlot(): boolean {
    return [...this.sessions.values()].filter((s) => s.status === 'running').length < MAX_CONCURRENT;
  }

  private promoteReady(): void {
    const waiting = [...this.sessions.values()]
      .filter((s) => s.status === 'queued' && this.depsSatisfied(s))
      .sort((a, b) => a.createdAt - b.createdAt);
    for (const s of waiting) {
      if (!this.hasSlot()) break;
      this.log(
        s,
        'system',
        (s.dependsOn?.length ?? 0) > 0 ? '依存タスクが完了。開始します。' : '実行スロットが空きました。開始します。'
      );
      this.run(s, s.prompt, false);
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
    this.promoteReady(); // ③ スロット解放
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

/**
 * デモモード判定：**ビルド時フラグのみ**で決まる。
 * 本番ビルド（VITE_CORRAL_DEMO 未指定）では URL パラメータ等で
 * デモに切り替えることはできない（誤ってデモを触る事故を防ぐ）。
 * この定数はビルド時に確定するため、本番ビルドではデモ実装ごと除去される。
 */
export const IS_DEMO = import.meta.env.VITE_CORRAL_DEMO === '1';

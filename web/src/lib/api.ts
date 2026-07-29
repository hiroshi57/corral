// REST API クライアント（デモモード時はブラウザ内バックエンドへ委譲）
import type { AgentKind, FinopsSummary, LogLine, NotifyEvent, Repo, SessionSummary } from './types';
import { demoBackend, IS_DEMO } from './demo';
import { store, type User, type WorkspaceInfo } from './auth';

const BASE = '/api';

// 本番（同一オリジン配信）では HTML に注入されたトークンを送る。
// 開発では Vite プロキシがヘッダを付与するため undefined でよい。
const TOKEN: string | undefined = (window as unknown as { __CORRAL_TOKEN__?: string })
  .__CORRAL_TOKEN__;

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (TOKEN) headers['x-corral-token'] = TOKEN;
  const sess = store.getSession();
  if (sess) headers['x-corral-session'] = sess;
  headers['x-corral-workspace'] = store.getWorkspace();
  const res = await fetch(BASE + path, { headers, ...init });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const api = {
  health: () =>
    IS_DEMO
      ? Promise.resolve({
          ok: true,
          demo: true,
          repoRoot: '(browser demo)',
          notifyChannels: [] as string[],
          budgetUsd: 0,
          execMode: 'local',
          guardrails: true,
        })
      : req<{
          ok: boolean;
          demo: boolean;
          repoRoot: string;
          notifyChannels?: string[];
          budgetUsd?: number;
          execMode?: string;
          guardrails?: boolean;
        }>('/health'),

  listSessions: () =>
    IS_DEMO
      ? Promise.resolve(demoBackend.list(store.getWorkspace()))
      : req<SessionSummary[]>('/sessions'),

  getSession: (id: string) =>
    IS_DEMO
      ? Promise.resolve(demoBackend.getSession(id) as SessionSummary & { logs: LogLine[] })
      : req<SessionSummary & { logs: LogLine[] }>(`/sessions/${id}`),

  createSessions: (input: {
    agent: AgentKind;
    prompt: string;
    count?: number;
    autoAccept?: boolean;
    title?: string;
    repoId?: string;
  }) =>
    IS_DEMO
      ? Promise.resolve(demoBackend.createSessions(input, store.getWorkspace()))
      : req<SessionSummary[]>('/sessions', {
          method: 'POST',
          body: JSON.stringify(input),
        }),

  instruct: (id: string, text: string) =>
    IS_DEMO
      ? Promise.resolve(demoBackend.instruct(id, text))
      : req<{ ok: boolean }>(`/sessions/${id}/instruct`, {
          method: 'POST',
          body: JSON.stringify({ text }),
        }),

  broadcast: (text: string, targetIds?: string[]) =>
    IS_DEMO
      ? Promise.resolve(demoBackend.broadcast(text, targetIds))
      : req<{ delivered: number }>('/broadcast', {
          method: 'POST',
          body: JSON.stringify({ text, targetIds }),
        }),

  diff: (id: string) =>
    IS_DEMO ? Promise.resolve(demoBackend.diff(id)) : req<{ diff: string }>(`/sessions/${id}/diff`),

  approve: (id: string, message?: string) =>
    IS_DEMO
      ? Promise.resolve(demoBackend.approve(id))
      : req<{ ok: boolean }>(`/sessions/${id}/approve`, {
          method: 'POST',
          body: JSON.stringify({ message }),
        }),

  stop: (id: string) =>
    IS_DEMO ? Promise.resolve(demoBackend.stop(id)) : req<{ ok: boolean }>(`/sessions/${id}/stop`, { method: 'POST' }),

  remove: (id: string) =>
    IS_DEMO ? Promise.resolve(demoBackend.remove(id)) : req<{ ok: boolean }>(`/sessions/${id}`, { method: 'DELETE' }),

  finops: () =>
    IS_DEMO ? Promise.resolve(demoBackend.finops(store.getWorkspace())) : req<FinopsSummary>('/finops'),

  notifyTest: () =>
    IS_DEMO
      ? Promise.resolve<NotifyEvent>({
          ts: Date.now(),
          sessionId: 'test',
          title: '通知テスト',
          status: 'done',
          channels: ['app'],
          message: '✅ 通知テスト',
        })
      : req<NotifyEvent>('/notify/test', { method: 'POST' }),

  // ⑤ 認証
  authProviders: () =>
    IS_DEMO
      ? Promise.resolve({ devLogin: true, google: false })
      : req<{ devLogin: boolean; google: boolean }>('/auth/providers'),

  loginDev: (email: string, name?: string) =>
    IS_DEMO
      ? Promise.resolve(demoBackend.loginDev(email, name))
      : req<{ token: string; user: User }>('/auth/login/dev', {
          method: 'POST',
          body: JSON.stringify({ email, name }),
        }),

  me: () =>
    IS_DEMO
      ? Promise.resolve(demoBackend.me())
      : req<{ user: User; workspaces: WorkspaceInfo[] }>('/auth/me'),

  // ④ ワークスペース（案件）
  listWorkspaces: () =>
    IS_DEMO
      ? Promise.resolve(demoBackend.listWorkspaces())
      : req<WorkspaceInfo[]>('/workspaces'),

  createWorkspace: (name: string) =>
    IS_DEMO
      ? Promise.resolve(demoBackend.createWorkspace(name))
      : req<WorkspaceInfo>('/workspaces', { method: 'POST', body: JSON.stringify({ name }) }),

  // #4 マルチリポ
  listRepos: () =>
    IS_DEMO ? Promise.resolve(demoBackend.listRepos(store.getWorkspace())) : req<Repo[]>('/repos'),

  // ドキュメント → LLM プランナー（実エージェント）。demo/失敗時は空→client がフォールバック
  planTasks: (text: string, agent?: AgentKind) =>
    IS_DEMO
      ? Promise.resolve<{ tasks: string[] }>({ tasks: [] })
      : req<{ tasks: string[] }>('/intake/plan', {
          method: 'POST',
          body: JSON.stringify({ text, agent }),
        }).catch(() => ({ tasks: [] as string[] })),
};

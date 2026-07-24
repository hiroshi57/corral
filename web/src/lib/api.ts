// REST API クライアント（デモモード時はブラウザ内バックエンドへ委譲）
import type { AgentKind, LogLine, SessionSummary } from './types';
import { demoBackend, IS_DEMO } from './demo';

const BASE = '/api';

// 本番（同一オリジン配信）では HTML に注入されたトークンを送る。
// 開発では Vite プロキシがヘッダを付与するため undefined でよい。
const TOKEN: string | undefined = (window as unknown as { __CORRAL_TOKEN__?: string })
  .__CORRAL_TOKEN__;

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (TOKEN) headers['x-corral-token'] = TOKEN;
  const res = await fetch(BASE + path, { headers, ...init });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const api = {
  health: () =>
    IS_DEMO
      ? Promise.resolve({ ok: true, demo: true, repoRoot: '(browser demo)' })
      : req<{ ok: boolean; demo: boolean; repoRoot: string }>('/health'),

  listSessions: () =>
    IS_DEMO ? Promise.resolve(demoBackend.list()) : req<SessionSummary[]>('/sessions'),

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
  }) =>
    IS_DEMO
      ? Promise.resolve(demoBackend.createSessions(input))
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
};

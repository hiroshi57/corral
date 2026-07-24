// REST API クライアント
import type { AgentKind, LogLine, SessionSummary } from './types';

const BASE = '/api';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const api = {
  health: () => req<{ ok: boolean; demo: boolean; repoRoot: string }>('/health'),

  listSessions: () => req<SessionSummary[]>('/sessions'),

  getSession: (id: string) =>
    req<SessionSummary & { logs: LogLine[] }>(`/sessions/${id}`),

  createSessions: (input: {
    agent: AgentKind;
    prompt: string;
    count?: number;
    autoAccept?: boolean;
    title?: string;
  }) =>
    req<SessionSummary[]>('/sessions', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  instruct: (id: string, text: string) =>
    req<{ ok: boolean }>(`/sessions/${id}/instruct`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),

  broadcast: (text: string, targetIds?: string[]) =>
    req<{ delivered: number }>('/broadcast', {
      method: 'POST',
      body: JSON.stringify({ text, targetIds }),
    }),

  diff: (id: string) => req<{ diff: string }>(`/sessions/${id}/diff`),

  approve: (id: string, message?: string) =>
    req<{ ok: boolean }>(`/sessions/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),

  stop: (id: string) => req<{ ok: boolean }>(`/sessions/${id}/stop`, { method: 'POST' }),

  remove: (id: string) => req<{ ok: boolean }>(`/sessions/${id}`, { method: 'DELETE' }),
};

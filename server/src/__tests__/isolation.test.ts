import { describe, expect, it } from 'vitest';
import { visibleTo, workspaceOfEvent, authenticateWs } from '../ws/hub.js';
import { childEnv } from '../session/runner.js';
import { scanSecrets } from '../guardrails/policy.js';
import { config } from '../config.js';
import type { IncomingMessage } from 'node:http';
import type { ServerEvent, SessionSummary } from '../types.js';

function summary(id: string, workspaceId: string): SessionSummary {
  return { id, workspaceId } as unknown as SessionSummary;
}

const req = (url: string, headers: Record<string, string> = {}) =>
  ({ url, headers } as unknown as IncomingMessage);

describe('WebSocket の認証', () => {
  it('資格情報なしの接続は拒否される', () => {
    expect(authenticateWs(req('/ws'))).toBeNull();
  });

  it('不正なセッションは拒否される', () => {
    expect(authenticateWs(req('/ws?session=not-a-token'))).toBeNull();
  });

  it('マシントークンはオーナーとして認証される', () => {
    expect(authenticateWs(req(`/ws?token=${config.token}`))).toMatchObject({ machine: true });
  });

  it('ヘッダのマシントークンも受け付ける（非ブラウザ用）', () => {
    expect(authenticateWs(req('/ws', { 'x-corral-token': config.token }))).toMatchObject({
      machine: true,
    });
  });
});

describe('WebSocket 配信の案件スコープ', () => {
  const index = new Map<string, string>();
  const clientA = { workspaceId: 'ws-a', role: 'member' as const };
  const clientB = { workspaceId: 'ws-b', role: 'member' as const };

  it('他案件のセッション更新は配信されない', () => {
    const e: ServerEvent = { type: 'session:update', session: summary('s1', 'ws-a') };
    const w = workspaceOfEvent(e, index);
    expect(visibleTo(clientA, e, w)).toBe(true);
    expect(visibleTo(clientB, e, w)).toBe(false);
  });

  it('ログは所属案件のクライアントにのみ配信される', () => {
    index.set('s1', 'ws-a');
    const e: ServerEvent = { type: 'log', id: 's1', line: { ts: 0, stream: 'stdout', text: 'x' } };
    const w = workspaceOfEvent(e, index);
    expect(visibleTo(clientA, e, w)).toBe(true);
    expect(visibleTo(clientB, e, w)).toBe(false);
  });

  it('案件不明のイベントは誰にも配信しない（既定で閉じる）', () => {
    const e: ServerEvent = { type: 'log', id: 'unknown', line: { ts: 0, stream: 'stdout', text: 'x' } };
    expect(visibleTo(clientA, e, workspaceOfEvent(e, index))).toBe(false);
  });

  it('マシン(オーナー)接続は全案件を購読できる', () => {
    const e: ServerEvent = { type: 'session:update', session: summary('s2', 'ws-b') };
    expect(visibleTo({ workspaceId: '*', role: 'owner' }, e, workspaceOfEvent(e, index))).toBe(true);
  });

  it('予算イベントは監査権限のない member/viewer には配信されない', () => {
    const e: ServerEvent = { type: 'budget', level: 'alert', totalUsd: 1, budgetUsd: 2 };
    expect(visibleTo(clientA, e, null)).toBe(false);
    expect(visibleTo({ workspaceId: 'ws-a', role: 'viewer' }, e, null)).toBe(false);
    expect(visibleTo({ workspaceId: 'ws-a', role: 'admin' }, e, null)).toBe(true);
  });
});

describe('子プロセスへ渡す環境変数', () => {
  const source = {
    PATH: '/usr/bin',
    CORRAL_TOKEN: 'secret-token',
    CORRAL_SAML_IDP_CERT: 'cert',
    CORRAL_CHATWORK_TOKEN: 'cw',
    CORRAL_SESSION_SECRET: 'sess',
    ANTHROPIC_API_KEY: 'sk-ant-xxx',
    SOME_UNRELATED: 'x',
  };

  it('corral 自身の秘密は渡さない', () => {
    const env = childEnv(source);
    expect(Object.keys(env).filter((k) => k.startsWith('CORRAL_'))).toEqual([]);
  });

  it('エージェントが必要とする資格情報と PATH は渡す', () => {
    const env = childEnv(source);
    expect(env.PATH).toBe('/usr/bin');
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-xxx');
  });

  it('allowlist 外の変数は渡さない', () => {
    expect(childEnv(source).SOME_UNRELATED).toBeUndefined();
  });
});

describe('機密マスキング', () => {
  it('ハイフンを含む Anthropic 形式のキーを検出・マスクする', () => {
    const r = scanSecrets('key=sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789');
    expect(r.violations.length).toBeGreaterThan(0);
    expect(r.redacted).not.toContain('abcdefghijklmnopqrstuvwxyz');
  });

  it('OpenAI の sk-proj- 形式も検出する', () => {
    expect(scanSecrets('sk-proj-abcdefghijklmnopqrstuvwxyz012345').violations.length).toBeGreaterThan(0);
  });

  it('無関係な文字列は検出しない', () => {
    expect(scanSecrets('ふつうのログ行です').violations).toEqual([]);
  });
});

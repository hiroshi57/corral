// WebSocket ハブ：状態・ログをブラウザへ push
//
// セキュリティ設計:
//  - ハンドシェイクで必ず認証する（x-corral-token ヘッダ / ?token= / ?session=）。
//    ブラウザは WebSocket にヘッダを付けられないため、セッションはクエリで受け取る。
//  - 配信は案件(ワークスペース)単位にスコープする。認証なし・全件配信だと
//    マルチテナント分離が WS 層で破れる。
import { WebSocketServer, WebSocket } from 'ws';
import type { Server, IncomingMessage } from 'node:http';
import type { SessionManager } from '../session/manager.js';
import type { Role, ServerEvent } from '../types.js';
import { config } from '../config.js';
import { verifySession } from '../auth/tokens.js';
import { tenancy, MACHINE_USER } from '../tenancy/store.js';
import { can } from '../auth/rbac.js';

/** マシントークン（オーナー）は全案件を購読できることを表す印 */
const ALL_WORKSPACES = '*';

interface Client {
  ws: WebSocket;
  workspaceId: string;
  role: Role;
}

export interface WsIdentity {
  userId: string;
  machine: boolean;
}

function queryOf(req: IncomingMessage): URLSearchParams {
  return new URL(req.url ?? '/', 'http://localhost').searchParams;
}

/** ハンドシェイクの認証。REST と同じ資格情報を受け付ける */
export function authenticateWs(req: IncomingMessage): WsIdentity | null {
  const q = queryOf(req);
  const headerToken = req.headers['x-corral-token'];
  if (headerToken === config.token || q.get('token') === config.token) {
    return { userId: MACHINE_USER.id, machine: true };
  }
  const headerSession = req.headers['x-corral-session'];
  const raw = typeof headerSession === 'string' ? headerSession : q.get('session');
  if (raw) {
    const claims = verifySession(raw);
    if (claims) return { userId: claims.sub, machine: false };
  }
  return null;
}

function hostAllowed(req: IncomingMessage): boolean {
  const host = (req.headers.host ?? '').split(':')[0];
  return config.allowedHosts.has(host);
}

/** イベントが属する案件。null = 案件に紐づかない全体イベント */
export function workspaceOfEvent(e: ServerEvent, index: Map<string, string>): string | null {
  switch (e.type) {
    case 'session:update':
      index.set(e.session.id, e.session.workspaceId);
      return e.session.workspaceId;
    case 'log':
      return index.get(e.id) ?? null;
    case 'session:removed': {
      const w = index.get(e.id) ?? null;
      index.delete(e.id);
      return w;
    }
    case 'guardrail':
      return index.get(e.sessionId) ?? null;
    case 'notify':
      return index.get(e.event.sessionId) ?? null;
    default:
      return null;
  }
}

/** この接続にイベントを流してよいか */
export function visibleTo(
  client: { workspaceId: string; role: Role },
  e: ServerEvent,
  workspaceId: string | null
): boolean {
  // 全体集計（予算）は監査/管理権限を持つ者だけに流す
  if (e.type === 'budget') {
    return client.workspaceId === ALL_WORKSPACES || can(client.role, 'audit:view');
  }
  if (client.workspaceId === ALL_WORKSPACES) return true;
  if (workspaceId === null) return false;
  return client.workspaceId === workspaceId;
}

export function attachWebSocket(httpServer: Server, sessions: SessionManager): void {
  /** sessionId -> workspaceId。ログ等の軽量イベントを案件に紐づける索引 */
  const index = new Map<string, string>();
  const clients = new Set<Client>();

  const wss = new WebSocketServer({
    server: httpServer,
    path: '/ws',
    // WS は CORS 対象外のため、ハンドシェイク時に Host / Origin / 認証を検証する
    verifyClient: ({ origin, req }: { origin?: string; req: IncomingMessage }) => {
      if (!hostAllowed(req)) return false;
      // ブラウザからは必ず Origin が付く。許可外オリジンは拒否
      if (origin && !config.allowedOrigins.includes(origin)) return false;
      // 認証必須（Origin なしの非ブラウザクライアントにも資格情報を要求する）
      return authenticateWs(req) !== null;
    },
  });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const identity = authenticateWs(req);
    if (!identity) {
      ws.close(4401, '認証が必要です');
      return;
    }

    let workspaceId = ALL_WORKSPACES;
    let role: Role = 'owner';
    if (!identity.machine) {
      const requested = queryOf(req).get('workspace') || 'default';
      const resolved = tenancy.roleOf(identity.userId, requested);
      if (!resolved || !can(resolved, 'session:view')) {
        ws.close(4403, 'この案件へのアクセス権がありません');
        return;
      }
      workspaceId = requested;
      role = resolved;
    }

    const client: Client = { ws, workspaceId, role };
    clients.add(client);
    ws.on('close', () => clients.delete(client));

    const snapshot = sessions.list(workspaceId === ALL_WORKSPACES ? undefined : workspaceId);
    for (const s of snapshot) index.set(s.id, s.workspaceId);
    send(ws, { type: 'snapshot', sessions: snapshot });
  });

  sessions.on('event', (event: ServerEvent) => {
    const workspaceId = workspaceOfEvent(event, index);
    const payload = JSON.stringify(event);
    for (const client of clients) {
      if (client.ws.readyState !== WebSocket.OPEN) continue;
      if (!visibleTo(client, event, workspaceId)) continue;
      client.ws.send(payload);
    }
  });
}

function send(ws: WebSocket, event: ServerEvent): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
}

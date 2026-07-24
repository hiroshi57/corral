// WebSocket ハブ：状態・ログをブラウザへ push
import { WebSocketServer, WebSocket } from 'ws';
import type { Server, IncomingMessage } from 'node:http';
import type { SessionManager } from '../session/manager.js';
import type { ServerEvent } from '../types.js';
import { config } from '../config.js';

export function attachWebSocket(httpServer: Server, sessions: SessionManager): void {
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/ws',
    // WS は CORS 対象外のため、ハンドシェイク時に Origin と Host を検証する
    verifyClient: ({ origin, req }: { origin?: string; req: IncomingMessage }) => {
      const host = (req.headers.host ?? '').split(':')[0];
      if (!config.allowedHosts.has(host)) return false;
      // ブラウザからは必ず Origin が付く。許可外オリジンは拒否（非ブラウザは Origin なし）
      if (origin && !config.allowedOrigins.includes(origin)) return false;
      return true;
    },
  });

  wss.on('connection', (ws: WebSocket) => {
    send(ws, { type: 'snapshot', sessions: sessions.list() });
  });

  sessions.on('event', (event: ServerEvent) => {
    const payload = JSON.stringify(event);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  });
}

function send(ws: WebSocket, event: ServerEvent): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
}

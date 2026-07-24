// WebSocket ハブ：状態・ログをブラウザへ push
import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import type { SessionManager } from '../session/manager.js';
import type { ServerEvent } from '../types.js';

export function attachWebSocket(httpServer: Server, sessions: SessionManager): void {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws: WebSocket) => {
    // 接続直後に現在のスナップショットを送る
    send(ws, { type: 'snapshot', sessions: sessions.list() });
  });

  // マネージャのイベントを全クライアントへ中継
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

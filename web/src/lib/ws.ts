// WebSocket 接続（自動再接続つき）。デモモード時はブラウザ内バックエンドを購読する。
import type { ServerEvent } from './types';
import { demoBackend, IS_DEMO } from './demo';
import { store } from './auth';

export function connectWs(onEvent: (e: ServerEvent) => void): () => void {
  // デモモード：WebSocket の代わりにブラウザ内バックエンドのイベントを購読
  if (IS_DEMO) {
    return demoBackend.subscribe(onEvent);
  }

  let ws: WebSocket | null = null;
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | null = null;

  // WebSocket はヘッダを付けられないため、資格情報と対象案件はクエリで渡す。
  // 再接続時に最新のセッション/案件を読み直せるよう open() 内で組み立てる。
  const buildUrl = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const q = new URLSearchParams();
    const token = (window as unknown as { __CORRAL_TOKEN__?: string }).__CORRAL_TOKEN__;
    if (token) q.set('token', token);
    const session = store.getSession();
    if (session) q.set('session', session);
    q.set('workspace', store.getWorkspace());
    return `${proto}://${location.host}/ws?${q.toString()}`;
  };

  const open = () => {
    ws = new WebSocket(buildUrl());
    ws.onmessage = (ev) => {
      try {
        onEvent(JSON.parse(ev.data) as ServerEvent);
      } catch {
        /* ignore */
      }
    };
    ws.onclose = () => {
      if (!closed) retry = setTimeout(open, 1500);
    };
    ws.onerror = () => ws?.close();
  };

  open();

  return () => {
    closed = true;
    if (retry) clearTimeout(retry);
    ws?.close();
  };
}

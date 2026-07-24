// WebSocket 接続（自動再接続つき）。デモモード時はブラウザ内バックエンドを購読する。
import type { ServerEvent } from './types';
import { demoBackend, IS_DEMO } from './demo';

export function connectWs(onEvent: (e: ServerEvent) => void): () => void {
  // デモモード：WebSocket の代わりにブラウザ内バックエンドのイベントを購読
  if (IS_DEMO) {
    return demoBackend.subscribe(onEvent);
  }

  let ws: WebSocket | null = null;
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | null = null;

  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

  const open = () => {
    ws = new WebSocket(url);
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

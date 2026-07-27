// ① 通知センター（ベル）: 完了/要確認/エラーをまとめて表示。
// アプリ内通知は常に、外部(Chatwork/Slack)は本番でデーモンが送信する。
import { useState } from 'react';
import type { NotifyEvent } from '../lib/types';
import { STATUS_META } from '../lib/types';
import { api } from '../lib/api';

export function NotificationCenter({
  notifications,
  channels,
  onSelect,
  onClear,
}: {
  notifications: NotifyEvent[];
  channels: string[];
  onSelect: (sessionId: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(0);
  const unread = Math.max(0, notifications.length - seen);

  const toggle = () => {
    setOpen((o) => !o);
    if (!open) setSeen(notifications.length);
  };

  return (
    <div className="relative">
      <button
        onClick={toggle}
        className="relative rounded-lg border border-edge bg-panel px-2.5 py-1.5 text-sm hover:border-accent"
        title="通知"
      >
        🔔
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
            {unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 rounded-xl border border-edge bg-panel2 shadow-2xl">
          <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
            <span className="text-sm font-bold">通知</span>
            <span className="text-[10px] text-slate-500">
              外部連携: {channels.length ? channels.join(' / ') : 'アプリ内のみ'}
            </span>
            <button
              onClick={() => api.notifyTest()}
              className="ml-auto text-[11px] text-slate-400 hover:text-accent"
            >
              テスト送信
            </button>
            <button onClick={onClear} className="text-[11px] text-slate-400 hover:text-rose-300">
              クリア
            </button>
          </div>
          <div className="max-h-80 overflow-auto">
            {notifications.length === 0 && (
              <div className="px-3 py-6 text-center text-xs text-slate-600">通知はありません</div>
            )}
            {[...notifications]
              .reverse()
              .slice(0, 50)
              .map((n, i) => {
                const meta = STATUS_META[n.status];
                return (
                  <button
                    key={i}
                    onClick={() => {
                      onSelect(n.sessionId);
                      setOpen(false);
                    }}
                    className="flex w-full items-center gap-2 border-b border-edge/50 px-3 py-2 text-left hover:bg-panel"
                  >
                    <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
                    <span className="flex-1 truncate text-xs">{n.title}</span>
                    <span className={`text-[10px] ${meta.color}`}>{meta.label}</span>
                    <span className="text-[10px] text-slate-600">
                      {new Date(n.ts).toLocaleTimeString('ja-JP', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </button>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}

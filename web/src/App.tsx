// Corral メイン画面
import { useEffect, useMemo, useState } from 'react';
import { CommandDeck } from './components/CommandDeck';
import { WorkerCard } from './components/WorkerCard';
import { DetailPanel } from './components/DetailPanel';
import { NotificationCenter } from './components/NotificationCenter';
import { Dashboard } from './components/Dashboard';
import { api } from './lib/api';
import { connectWs } from './lib/ws';
import type { LogLine, NotifyEvent, SessionStatus, SessionSummary } from './lib/types';
import { STATUS_META } from './lib/types';

const STATUS_ORDER: SessionStatus[] = [
  'needs_review',
  'running',
  'queued',
  'error',
  'done',
  'stopped',
];

type View = 'command' | 'dashboard';

interface BudgetBanner {
  level: 'alert' | 'exceeded';
  totalUsd: number;
  budgetUsd: number;
}

export default function App() {
  const [sessions, setSessions] = useState<Record<string, SessionSummary>>({});
  const [logs, setLogs] = useState<Record<string, LogLine[]>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
  const [view, setView] = useState<View>('command');
  const [notifications, setNotifications] = useState<NotifyEvent[]>([]);
  const [channels, setChannels] = useState<string[]>([]);
  const [budget, setBudget] = useState<BudgetBanner | null>(null);

  useEffect(() => {
    api
      .health()
      .then((h) => {
        setDemo(h.demo);
        setChannels(h.notifyChannels ?? []);
      })
      .catch(() => {});
    const disconnect = connectWs((e) => {
      switch (e.type) {
        case 'snapshot':
          setSessions(Object.fromEntries(e.sessions.map((s) => [s.id, s])));
          break;
        case 'session:update':
          setSessions((prev) => ({ ...prev, [e.session.id]: e.session }));
          break;
        case 'session:removed':
          setSessions((prev) => {
            const next = { ...prev };
            delete next[e.id];
            return next;
          });
          setSelected((cur) => (cur === e.id ? null : cur));
          break;
        case 'log':
          setLogs((prev) => ({
            ...prev,
            [e.id]: [...(prev[e.id] ?? []), e.line].slice(-1000),
          }));
          break;
        case 'notify':
          setNotifications((prev) => [...prev, e.event].slice(-100));
          break;
        case 'budget':
          setBudget({ level: e.level, totalUsd: e.totalUsd, budgetUsd: e.budgetUsd });
          break;
      }
    });
    return disconnect;
  }, []);

  // 選択セッションの過去ログを取得（再接続時などに補完）
  useEffect(() => {
    if (selected && !logs[selected]) {
      api.getSession(selected).then((s) => {
        setLogs((prev) => ({ ...prev, [selected]: s.logs }));
      });
    }
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const sorted = useMemo(() => {
    return Object.values(sessions).sort((a, b) => {
      const d = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
      return d !== 0 ? d : b.updatedAt - a.updatedAt;
    });
  }, [sessions]);

  const counts = useMemo(() => {
    const c: Partial<Record<SessionStatus, number>> = {};
    for (const s of Object.values(sessions)) c[s.status] = (c[s.status] ?? 0) + 1;
    return c;
  }, [sessions]);

  const refresh = () =>
    api.listSessions().then((list) => setSessions(Object.fromEntries(list.map((s) => [s.id, s]))));

  const selectedSession = selected ? sessions[selected] ?? null : null;

  const TabBtn = ({ v, label }: { v: View; label: string }) => (
    <button
      onClick={() => setView(v)}
      className={`rounded-lg px-3 py-1 text-sm ${
        view === v ? 'bg-accent text-black font-bold' : 'text-slate-300 hover:bg-edge'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex h-full flex-col">
      {/* ヘッダ */}
      <header className="flex items-center gap-3 border-b border-edge bg-panel px-5 py-3">
        <span className="text-xl">🐎</span>
        <h1 className="text-lg font-bold">Corral</h1>
        <span className="hidden text-xs text-slate-500 sm:inline">エージェント司令塔</span>
        {demo && (
          <span className="rounded border border-amber-500/30 bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-300">
            DEMO モード
          </span>
        )}
        <div className="ml-3 flex items-center gap-1 rounded-lg border border-edge bg-panel2 p-0.5">
          <TabBtn v="command" label="🎯 司令塔" />
          <TabBtn v="dashboard" label="📊 ダッシュボード" />
        </div>

        <div className="ml-auto flex items-center gap-3">
          <div className="hidden items-center gap-3 text-xs lg:flex">
            {STATUS_ORDER.map((st) =>
              counts[st] ? (
                <span key={st} className="flex items-center gap-1">
                  <span className={`h-2 w-2 rounded-full ${STATUS_META[st].dot}`} />
                  <span className={STATUS_META[st].color}>{STATUS_META[st].label}</span>
                  <span className="text-slate-400">{counts[st]}</span>
                </span>
              ) : null
            )}
          </div>
          <NotificationCenter
            notifications={notifications}
            channels={channels}
            onSelect={(id) => {
              setView('command');
              setSelected(id);
            }}
            onClear={() => setNotifications([])}
          />
        </div>
      </header>

      {/* 予算バナー */}
      {budget && (
        <div
          className={`flex items-center gap-2 px-5 py-2 text-sm ${
            budget.level === 'exceeded'
              ? 'bg-rose-500/15 text-rose-200'
              : 'bg-amber-500/15 text-amber-200'
          }`}
        >
          <span>{budget.level === 'exceeded' ? '🚫 予算超過' : '⚠️ 予算アラート'}</span>
          <span>
            累計 ${budget.totalUsd.toFixed(2)} / 予算 ${budget.budgetUsd.toFixed(2)}
          </span>
          <button onClick={() => setBudget(null)} className="ml-auto text-xs opacity-70 hover:opacity-100">
            閉じる
          </button>
        </div>
      )}

      {/* 本体 */}
      {view === 'dashboard' ? (
        <div className="flex flex-1 min-h-0 flex-col p-4">
          <Dashboard sessions={Object.values(sessions)} />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="flex w-[420px] shrink-0 flex-col gap-3 overflow-auto border-r border-edge p-4">
            <CommandDeck onChanged={refresh} />
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-300">ワーカー（{sorted.length}）</h2>
            </div>
            <div className="flex flex-col gap-2">
              {sorted.length === 0 && (
                <div className="rounded-xl border border-dashed border-edge p-6 text-center text-xs text-slate-600">
                  まだワーカーがいません。
                  <br />
                  上の司令塔からタスクを起動してください。
                </div>
              )}
              {sorted.map((s) => (
                <WorkerCard
                  key={s.id}
                  session={s}
                  active={s.id === selected}
                  onSelect={() => setSelected(s.id)}
                />
              ))}
            </div>
          </div>

          <div className="flex min-h-0 flex-1 p-4">
            <DetailPanel
              session={selectedSession}
              logs={selected ? logs[selected] ?? [] : []}
              onChanged={refresh}
            />
          </div>
        </div>
      )}
    </div>
  );
}

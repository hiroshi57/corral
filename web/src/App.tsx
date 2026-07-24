// Corral メイン画面
import { useEffect, useMemo, useState } from 'react';
import { CommandDeck } from './components/CommandDeck';
import { WorkerCard } from './components/WorkerCard';
import { DetailPanel } from './components/DetailPanel';
import { api } from './lib/api';
import { connectWs } from './lib/ws';
import type { LogLine, SessionStatus, SessionSummary } from './lib/types';
import { STATUS_META } from './lib/types';

const STATUS_ORDER: SessionStatus[] = [
  'needs_review',
  'running',
  'queued',
  'error',
  'done',
  'stopped',
];

export default function App() {
  const [sessions, setSessions] = useState<Record<string, SessionSummary>>({});
  const [logs, setLogs] = useState<Record<string, LogLine[]>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);

  useEffect(() => {
    api.health().then((h) => setDemo(h.demo)).catch(() => {});
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

  const refresh = () => api.listSessions().then((list) =>
    setSessions(Object.fromEntries(list.map((s) => [s.id, s])))
  );

  const selectedSession = selected ? sessions[selected] ?? null : null;

  return (
    <div className="h-full flex flex-col">
      {/* ヘッダ */}
      <header className="flex items-center gap-3 px-5 py-3 border-b border-edge bg-panel">
        <span className="text-xl">🐎</span>
        <h1 className="font-bold text-lg">Corral</h1>
        <span className="text-xs text-slate-500">エージェント司令塔</span>
        {demo && (
          <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded px-2 py-0.5">
            DEMO モード
          </span>
        )}
        <div className="ml-auto flex items-center gap-3 text-xs">
          {STATUS_ORDER.map(
            (st) =>
              counts[st] ? (
                <span key={st} className="flex items-center gap-1">
                  <span className={`w-2 h-2 rounded-full ${STATUS_META[st].dot}`} />
                  <span className={STATUS_META[st].color}>{STATUS_META[st].label}</span>
                  <span className="text-slate-400">{counts[st]}</span>
                </span>
              ) : null
          )}
        </div>
      </header>

      {/* 本体：左=司令塔+一覧 / 右=詳細 */}
      <div className="flex-1 flex min-h-0">
        <div className="w-[420px] shrink-0 flex flex-col gap-3 p-4 overflow-auto border-r border-edge">
          <CommandDeck onChanged={refresh} />
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-300">
              ワーカー（{sorted.length}）
            </h2>
          </div>
          <div className="flex flex-col gap-2">
            {sorted.length === 0 && (
              <div className="text-xs text-slate-600 border border-dashed border-edge rounded-xl p-6 text-center">
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

        <div className="flex-1 flex min-h-0 p-4">
          <DetailPanel
            session={selectedSession}
            logs={selected ? logs[selected] ?? [] : []}
            onChanged={refresh}
          />
        </div>
      </div>
    </div>
  );
}

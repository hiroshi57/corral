// Corral メイン画面
import { useEffect, useMemo, useState } from 'react';
import { CommandDeck } from './components/CommandDeck';
import { WorkerCard } from './components/WorkerCard';
import { DetailPanel } from './components/DetailPanel';
import { NotificationCenter } from './components/NotificationCenter';
import { Dashboard } from './components/Dashboard';
import { WorkspaceBar } from './components/WorkspaceBar';
import { Login } from './components/Login';
import { api } from './lib/api';
import { connectWs } from './lib/ws';
import { can, store, ROLE_LABEL, type Role, type User, type WorkspaceInfo } from './lib/auth';
import { demoBackend, IS_DEMO } from './lib/demo';
import type { LogLine, NotifyEvent, Repo, SessionStatus, SessionSummary } from './lib/types';
import { STATUS_META } from './lib/types';

const STATUS_ORDER: SessionStatus[] = ['needs_review', 'running', 'queued', 'error', 'done', 'stopped'];

type View = 'command' | 'dashboard';
interface BudgetBanner { level: 'alert' | 'exceeded'; totalUsd: number; budgetUsd: number }

export default function App() {
  const [sessions, setSessions] = useState<Record<string, SessionSummary>>({});
  const [logs, setLogs] = useState<Record<string, LogLine[]>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
  const [view, setView] = useState<View>('command');
  const [notifications, setNotifications] = useState<NotifyEvent[]>([]);
  const [channels, setChannels] = useState<string[]>([]);
  const [budget, setBudget] = useState<BudgetBanner | null>(null);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [execMode, setExecMode] = useState('local');
  const [guardrailsOn, setGuardrailsOn] = useState(false);

  // ⑤/④ 認証・案件
  const [authReady, setAuthReady] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [providers, setProviders] = useState({ devLogin: true, google: false });
  const [user, setUser] = useState<User | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [currentWs, setCurrentWs] = useState<string>(store.getWorkspace());

  const role: Role = useMemo(
    () => workspaces.find((w) => w.id === currentWs)?.role ?? 'viewer',
    [workspaces, currentWs]
  );

  // 認証の初期化
  const initAuth = async () => {
    try {
      setProviders(await api.authProviders());
    } catch {
      /* ignore */
    }
    try {
      const me = await api.me();
      setUser(me.user);
      setWorkspaces(me.workspaces);
      const ws = me.workspaces.find((w) => w.id === store.getWorkspace())
        ? store.getWorkspace()
        : me.workspaces[0]?.id ?? 'default';
      store.setWorkspace(ws);
      setCurrentWs(ws);
      setNeedsLogin(false);
    } catch {
      setNeedsLogin(true);
    } finally {
      setAuthReady(true);
    }
  };

  useEffect(() => {
    // Google SSO コールバックの ?session= を取り込む
    const p = new URLSearchParams(location.search);
    const s = p.get('session');
    if (s) {
      store.setSession(s);
      history.replaceState({}, '', location.pathname);
    }
    api.health().then((h) => {
      setDemo(h.demo);
      setChannels(h.notifyChannels ?? []);
      setExecMode(h.execMode ?? 'local');
      setGuardrailsOn(!!h.guardrails);
    }).catch(() => {});
    initAuth().then(loadRepos);
    const disconnect = connectWs((e) => {
      switch (e.type) {
        case 'snapshot':
          setSessions(Object.fromEntries(e.sessions.map((x) => [x.id, x])));
          break;
        case 'session:update':
          setSessions((prev) => ({ ...prev, [e.session.id]: e.session }));
          break;
        case 'session:removed':
          setSessions((prev) => { const n = { ...prev }; delete n[e.id]; return n; });
          setSelected((cur) => (cur === e.id ? null : cur));
          break;
        case 'log':
          setLogs((prev) => ({ ...prev, [e.id]: [...(prev[e.id] ?? []), e.line].slice(-1000) }));
          break;
        case 'notify':
          setNotifications((prev) => [...prev, e.event].slice(-100));
          break;
        case 'budget':
          setBudget({ level: e.level, totalUsd: e.totalUsd, budgetUsd: e.budgetUsd });
          break;
        case 'guardrail':
          setNotifications((prev) => [
            ...prev,
            {
              ts: e.violation.ts,
              sessionId: e.sessionId,
              title: `🛡 ${e.violation.detail}`,
              status: 'error' as SessionStatus,
              channels: ['app'],
              message: e.violation.detail,
            },
          ].slice(-100));
          break;
      }
    });
    return disconnect;
  }, []);

  useEffect(() => {
    if (selected && !logs[selected]) {
      api.getSession(selected).then((s) => setLogs((prev) => ({ ...prev, [selected]: s.logs }))).catch(() => {});
    }
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  // 現在の案件に属するセッションだけを表示
  const wsSessions = useMemo(
    () => Object.values(sessions).filter((s) => s.workspaceId === currentWs),
    [sessions, currentWs]
  );

  const sorted = useMemo(
    () =>
      [...wsSessions].sort((a, b) => {
        const d = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
        return d !== 0 ? d : b.updatedAt - a.updatedAt;
      }),
    [wsSessions]
  );

  const counts = useMemo(() => {
    const c: Partial<Record<SessionStatus, number>> = {};
    for (const s of wsSessions) c[s.status] = (c[s.status] ?? 0) + 1;
    return c;
  }, [wsSessions]);

  const refresh = () =>
    api.listSessions().then((list) =>
      setSessions((prev) => {
        const next = { ...prev };
        for (const s of list) next[s.id] = s;
        return next;
      })
    );

  const loadRepos = () => api.listRepos().then(setRepos).catch(() => setRepos([]));

  // 案件切替
  const switchWs = (id: string) => {
    store.setWorkspace(id);
    setCurrentWs(id);
    setSelected(null);
    refresh();
    loadRepos();
  };
  const createWs = async (name: string) => {
    const ws = await api.createWorkspace(name);
    setWorkspaces((prev) => [...prev, ws]);
    switchWs(ws.id);
  };
  // デモのロール切替（RBAC 体験）
  const changeRole = async (r: Role) => {
    if (IS_DEMO) {
      demoBackend.setRole(r);
      const me = await api.me();
      setWorkspaces(me.workspaces);
    }
  };
  const doLogout = () => {
    store.clearSession();
    location.reload();
  };
  const onDevLogin = async (email: string, name: string) => {
    const { token } = await api.loginDev(email, name);
    store.setSession(token);
    await initAuth();
  };

  const canCreate = can(role, 'session:create');
  const canInstruct = can(role, 'session:instruct');
  const canApprove = can(role, 'session:approve');

  const selectedSession = selected ? sessions[selected] ?? null : null;

  if (!authReady) {
    return <div className="grid h-full place-items-center text-slate-500">読み込み中…</div>;
  }
  if (needsLogin) {
    return <Login providers={providers} onDevLogin={onDevLogin} />;
  }

  const TabBtn = ({ v, label }: { v: View; label: string }) => (
    <button
      onClick={() => setView(v)}
      className={`rounded-lg px-3 py-1 text-sm ${view === v ? 'bg-accent font-bold text-black' : 'text-slate-300 hover:bg-edge'}`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-edge bg-panel px-5 py-3">
        <span className="text-xl">🐎</span>
        <h1 className="text-lg font-bold">Corral</h1>
        {demo && (
          <span className="rounded border border-amber-500/30 bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-300">
            DEMO
          </span>
        )}
        <span
          className="rounded border border-edge bg-panel2 px-2 py-0.5 text-[10px] text-slate-400"
          title="実行モード（local / docker=サンドボックス / ssh=リモート）"
        >
          {execMode === 'docker' ? '📦 docker' : execMode === 'ssh' ? '🌐 ssh' : '💻 local'}
        </span>
        {guardrailsOn && (
          <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300" title="ポリシーガードレール 有効">
            🛡 ガードレール
          </span>
        )}
        <WorkspaceBar
          workspaces={workspaces}
          currentWs={currentWs}
          role={role}
          isDemo={IS_DEMO}
          user={user?.name ?? ''}
          onSwitch={switchWs}
          onCreate={createWs}
          onRoleChange={changeRole}
          onLogout={doLogout}
        />
        <div className="ml-1 flex items-center gap-1 rounded-lg border border-edge bg-panel2 p-0.5">
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
            onSelect={(id) => { setView('command'); setSelected(id); }}
            onClear={() => setNotifications([])}
          />
        </div>
      </header>

      {budget && (
        <div className={`flex items-center gap-2 px-5 py-2 text-sm ${budget.level === 'exceeded' ? 'bg-rose-500/15 text-rose-200' : 'bg-amber-500/15 text-amber-200'}`}>
          <span>{budget.level === 'exceeded' ? '🚫 予算超過' : '⚠️ 予算アラート'}</span>
          <span>累計 ${budget.totalUsd.toFixed(2)} / 予算 ${budget.budgetUsd.toFixed(2)}</span>
          <button onClick={() => setBudget(null)} className="ml-auto text-xs opacity-70 hover:opacity-100">閉じる</button>
        </div>
      )}

      {view === 'dashboard' ? (
        <div className="flex min-h-0 flex-1 flex-col p-4">
          <Dashboard sessions={wsSessions} />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="flex w-[420px] shrink-0 flex-col gap-3 overflow-auto border-r border-edge p-4">
            <CommandDeck onChanged={refresh} repos={repos} canCreate={canCreate} canInstruct={canInstruct} />
            {!canCreate && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
                現在のロール（{ROLE_LABEL[role]}）ではタスク起動・指示ができません。閲覧のみ可能です。
              </div>
            )}
            <h2 className="text-sm font-bold text-slate-300">ワーカー（{sorted.length}）</h2>
            <div className="flex flex-col gap-2">
              {sorted.length === 0 && (
                <div className="rounded-xl border border-dashed border-edge p-6 text-center text-xs text-slate-600">
                  この案件にはまだワーカーがいません。
                </div>
              )}
              {sorted.map((s) => (
                <WorkerCard key={s.id} session={s} active={s.id === selected} onSelect={() => setSelected(s.id)} />
              ))}
            </div>
          </div>

          <div className="flex min-h-0 flex-1 p-4">
            <DetailPanel
              session={selectedSession}
              logs={selected ? logs[selected] ?? [] : []}
              onChanged={refresh}
              canInstruct={canInstruct}
              canApprove={canApprove}
            />
          </div>
        </div>
      )}
    </div>
  );
}

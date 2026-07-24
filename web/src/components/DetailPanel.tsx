// 詳細ペイン：ログ出力 / diff レビュー / 承認・追加指示
import { useEffect, useRef, useState } from 'react';
import type { LogLine, SessionSummary } from '../lib/types';
import { AGENT_LABEL, STATUS_META } from '../lib/types';
import { api } from '../lib/api';

const STREAM_COLOR: Record<LogLine['stream'], string> = {
  stdout: 'text-slate-200',
  stderr: 'text-rose-300',
  system: 'text-accent',
};

export function DetailPanel({
  session,
  logs,
  onChanged,
}: {
  session: SessionSummary | null;
  logs: LogLine[];
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<'log' | 'diff'>('log');
  const [diff, setDiff] = useState('');
  const [instruction, setInstruction] = useState('');
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useEffect(() => {
    if (session && tab === 'diff') {
      api.diff(session.id).then((r) => setDiff(r.diff));
    }
  }, [session, tab]);

  if (!session) {
    return (
      <div className="flex-1 grid place-items-center text-slate-600 text-sm">
        ← ワーカーを選択すると、ここに端末と diff が表示されます
      </div>
    );
  }

  const meta = STATUS_META[session.status];

  const sendInstruction = async () => {
    if (!instruction.trim()) return;
    await api.instruct(session.id, instruction);
    setInstruction('');
    onChanged();
  };

  const approve = async () => {
    await api.approve(session.id, `corral: ${session.title}`);
    onChanged();
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-panel2 border border-edge rounded-xl overflow-hidden">
      {/* ヘッダ */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-edge">
        <span className={`w-2 h-2 rounded-full ${meta.dot}`} />
        <span className={`text-xs ${meta.color}`}>{meta.label}</span>
        <span className="font-medium truncate">{session.title}</span>
        <span className="text-[11px] text-slate-500 font-mono ml-1">
          {AGENT_LABEL[session.agent]} · {session.branch}
        </span>
        <div className="ml-auto flex gap-1">
          <button
            onClick={() => setTab('log')}
            className={`text-xs px-2 py-1 rounded ${tab === 'log' ? 'bg-edge' : 'text-slate-400'}`}
          >
            端末
          </button>
          <button
            onClick={() => setTab('diff')}
            className={`text-xs px-2 py-1 rounded ${tab === 'diff' ? 'bg-edge' : 'text-slate-400'}`}
          >
            差分{session.changedFiles > 0 ? ` (${session.changedFiles})` : ''}
          </button>
        </div>
      </div>

      {/* 本文 */}
      <div className="flex-1 overflow-auto p-3 font-mono text-xs leading-relaxed">
        {tab === 'log' ? (
          <>
            {logs.length === 0 && <div className="text-slate-600">出力待ち...</div>}
            {logs.map((l, i) => (
              <div key={i} className={STREAM_COLOR[l.stream]}>
                {l.stream === 'system' ? '» ' : ''}
                {l.text}
              </div>
            ))}
            <div ref={logEndRef} />
          </>
        ) : (
          <pre className="whitespace-pre-wrap text-slate-300">{diff || '差分はありません'}</pre>
        )}
      </div>

      {/* アクション */}
      <div className="border-t border-edge p-3 flex flex-col gap-2">
        <div className="flex gap-2">
          <input
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendInstruction()}
            placeholder="このワーカーへ追加指示 / 差し戻し"
            className="flex-1 bg-panel border border-edge rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-accent"
          />
          <button
            onClick={sendInstruction}
            className="bg-panel border border-edge rounded-lg px-3 text-sm hover:border-accent"
          >
            送信
          </button>
        </div>
        <div className="flex gap-2">
          <button
            onClick={approve}
            disabled={session.status === 'done'}
            className="bg-emerald-500/90 text-black font-bold rounded-lg px-3 py-1.5 text-sm disabled:opacity-40"
          >
            ✓ 承認してcommit
          </button>
          <button
            onClick={() => api.stop(session.id).then(onChanged)}
            className="bg-panel border border-edge rounded-lg px-3 py-1.5 text-sm hover:border-amber-400"
          >
            ■ 停止
          </button>
          <button
            onClick={() => api.remove(session.id).then(onChanged)}
            className="ml-auto bg-panel border border-edge rounded-lg px-3 py-1.5 text-sm text-rose-300 hover:border-rose-500"
          >
            🗑 破棄
          </button>
        </div>
      </div>
    </div>
  );
}

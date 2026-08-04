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
  canInstruct = true,
  canApprove = true,
}: {
  session: SessionSummary | null;
  logs: LogLine[];
  onChanged: () => void;
  canInstruct?: boolean;
  canApprove?: boolean;
}) {
  const [tab, setTab] = useState<'log' | 'diff'>('log');
  const [diff, setDiff] = useState('');
  const [instruction, setInstruction] = useState('');
  // #6 インラインコメント（diff の行に指摘を付けて差し戻し）
  const [comments, setComments] = useState<Array<{ target: string; note: string }>>([]);
  // #24 セッションリプレイ
  const [replaying, setReplaying] = useState(false);
  const [replayCount, setReplayCount] = useState(0);
  // ④ PR 自動作成
  const [prBusy, setPrBusy] = useState(false);
  const [prMsg, setPrMsg] = useState<{ ok: boolean; text: string; url?: string } | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs, replayCount]);

  // #24 リプレイ: ログを時系列で少しずつ再生
  useEffect(() => {
    if (!replaying) return;
    if (replayCount >= logs.length) {
      setReplaying(false);
      return;
    }
    const t = setTimeout(() => setReplayCount((c) => c + 1), 250);
    return () => clearTimeout(t);
  }, [replaying, replayCount, logs.length]);

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

  const sendReview = async () => {
    const filled = comments.filter((c) => c.note.trim());
    if (!filled.length) return;
    const body =
      '以下のレビュー指摘を反映して修正してください:\n' +
      filled.map((c, i) => `${i + 1}. 対象「${c.target.slice(0, 80)}」→ 指摘: ${c.note}`).join('\n');
    await api.instruct(session.id, body);
    setComments([]);
    onChanged();
  };

  const createPr = async () => {
    setPrBusy(true);
    setPrMsg(null);
    try {
      const r = await api.createPr(session.id);
      setPrMsg({
        ok: r.ok,
        text: r.ok ? 'PR を作成しました' : `PR 作成失敗: ${r.error ?? '不明なエラー'}`,
        url: r.url,
      });
      onChanged();
    } finally {
      setPrBusy(false);
    }
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
          {tab === 'log' && logs.length > 0 && (
            <button
              onClick={() => {
                if (replaying) {
                  setReplaying(false);
                } else {
                  setReplayCount(0);
                  setReplaying(true);
                }
              }}
              className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-edge"
              title="セッションを時系列で再生"
            >
              {replaying ? '⏹ 停止' : '▶ リプレイ'}
            </button>
          )}
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
            {replaying && (
              <div className="mb-1 text-[10px] text-accent">
                ▶ リプレイ中 {replayCount}/{logs.length}
              </div>
            )}
            {(replaying ? logs.slice(0, replayCount) : logs).map((l, i) => (
              <div key={i} className={STREAM_COLOR[l.stream]}>
                {l.stream === 'system' ? '» ' : ''}
                {l.text}
              </div>
            ))}
            <div ref={logEndRef} />
          </>
        ) : diff ? (
          <div>
            <div className="mb-2 text-[10px] text-slate-500">
              行をクリックすると指摘（インラインコメント）を追加できます
            </div>
            {diff.split('\n').map((line, i) => {
              const added = line.startsWith('+');
              const removed = line.startsWith('-');
              return (
                <div
                  key={i}
                  onClick={() =>
                    canInstruct &&
                    line.trim() &&
                    setComments((prev) => [...prev, { target: line, note: '' }])
                  }
                  className={`cursor-pointer whitespace-pre-wrap px-1 hover:bg-edge/60 ${
                    added ? 'text-emerald-300' : removed ? 'text-rose-300' : 'text-slate-400'
                  }`}
                >
                  {line || ' '}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-slate-500">差分はありません</div>
        )}
      </div>

      {/* #6 インラインコメント（レビュー指摘） */}
      {tab === 'diff' && comments.length > 0 && (
        <div className="border-t border-edge bg-panel px-3 py-2">
          <div className="mb-1 text-[11px] font-bold text-accent">レビュー指摘（{comments.length}）</div>
          <div className="max-h-40 space-y-1 overflow-auto">
            {comments.map((c, i) => (
              <div key={i} className="flex items-start gap-2">
                <code className="mt-1 max-w-[40%] truncate text-[10px] text-slate-500">{c.target}</code>
                <input
                  autoFocus={i === comments.length - 1}
                  value={c.note}
                  onChange={(e) =>
                    setComments((prev) => prev.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))
                  }
                  placeholder="この行への指摘…"
                  className="flex-1 rounded border border-edge bg-panel2 px-2 py-1 text-xs focus:border-accent focus:outline-none"
                />
                <button onClick={() => setComments((prev) => prev.filter((_, j) => j !== i))} className="text-xs text-slate-500 hover:text-rose-300">✕</button>
              </div>
            ))}
          </div>
          <button
            onClick={sendReview}
            disabled={!canInstruct}
            className="mt-2 rounded-lg bg-accent px-3 py-1 text-xs font-bold text-black disabled:opacity-40"
          >
            ↩ 指摘を反映して差し戻し
          </button>
        </div>
      )}

      {/* #20 ガードレール違反 */}
      {session.violations?.length > 0 && (
        <div className="border-t border-rose-500/30 bg-rose-500/10 px-3 py-2">
          <div className="mb-1 text-[11px] font-bold text-rose-300">🛡 ガードレール（{session.violations.length}）</div>
          <ul className="space-y-0.5">
            {session.violations.slice(-5).map((v, i) => (
              <li key={i} className="text-[11px] text-rose-200">
                {v.blocked ? '⛔' : '⚠️'} {v.detail}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ④ PR 結果 */}
      {prMsg && (
        <div
          className={`border-t px-3 py-2 text-xs ${
            prMsg.ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-amber-500/30 bg-amber-500/10 text-amber-200'
          }`}
        >
          {prMsg.text}
          {prMsg.url && (
            <a href={prMsg.url} target="_blank" rel="noreferrer" className="ml-2 underline">
              {prMsg.url}
            </a>
          )}
          <button onClick={() => setPrMsg(null)} className="ml-2 opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* アクション */}
      <div className="border-t border-edge p-3 flex flex-col gap-2">
        <div className="flex gap-2">
          <input
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && canInstruct && sendInstruction()}
            disabled={!canInstruct}
            placeholder={canInstruct ? 'このワーカーへ追加指示 / 差し戻し' : '指示権限がありません（閲覧者）'}
            className="flex-1 bg-panel border border-edge rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-accent disabled:opacity-50"
          />
          <button
            onClick={sendInstruction}
            disabled={!canInstruct}
            className="bg-panel border border-edge rounded-lg px-3 text-sm hover:border-accent disabled:opacity-40"
          >
            送信
          </button>
        </div>
        <div className="flex gap-2">
          <button
            onClick={approve}
            disabled={session.status === 'done' || !canApprove}
            title={canApprove ? '' : '承認権限がありません'}
            className="bg-emerald-500/90 text-black font-bold rounded-lg px-3 py-1.5 text-sm disabled:opacity-40"
          >
            ✓ 承認してcommit
          </button>
          <button
            onClick={createPr}
            disabled={!canApprove || prBusy}
            title="変更を push して Pull Request を作成（要 gh CLI）"
            className="bg-panel border border-edge rounded-lg px-3 py-1.5 text-sm hover:border-accent disabled:opacity-40"
          >
            {prBusy ? '…' : '⇪ PR作成'}
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
